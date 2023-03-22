import { Cancelable, Disposable } from "@neutronstarer/cancelable"

export type Notify = (param: unknown) => Promise<void>

export type Handle = (param: unknown, cancelable: Cancelable, notify: Notify) => Promise<unknown>

export type Send = (message: Message) => void

export { Cancelable, Disposable }

export class Message {
  constructor(typ: Typ, id: number, method?: string, param?: unknown, error?: unknown) {
    this.typ = typ
    this.id = id
    this.method = method
    this.param = param
    this.error = error
  }
  readonly typ: Typ
  readonly id: number
  readonly method?: string
  readonly param: unknown
  readonly error: unknown
}

export enum Typ {
  emit = 0,
  deliver = 1,
  notify = 2,
  ack = 3,
  cancel = 4
}

/// [NPC] Near Procedure Call
export class NPC {
  /// connect with [send]
  connect(send: Send) {
    this.disconnect()
    this.send = send
  }
  /// disconnect [reason]
  disconnect(reason?: unknown) {
    const error = reason ?? "disconnected"
    const replies = new Array<(param: unknown, error: unknown) => boolean>()
    const cancels = new Array<()=>void>()
    this.replies.forEach((v) => {
      replies.push(v)
    })
    this.cancels.forEach((v) => {
      cancels.push(v)
    })
    replies.forEach((v)=>{
      v(undefined, error)
    })
    cancels.forEach((v)=>{
      v()
    })
    this.send = null
  }

  /// handle method
  on(method: string, handle: Handle | null) {
    if (handle == null) {
      this.handles.delete(method)
    } else {
      this.handles.set(method, handle)
    }
  }
  /// emit method
  emit(method: string, param: unknown) {
    const m = new Message(Typ.emit, this.nextId(), method, param)
    this.send?.call(this, m)
  }

  async deliver(method: string, param?: unknown, timeout: number = 0, cancelable?: Cancelable, onNotify?: Notify): Promise<unknown> {
    const id = this.nextId()
    const promise = new Promise<unknown>((resolve, reject) => {
      let completed = false
      let timer: any
      let disposable: Disposable
      if (onNotify != undefined) {
        this.notifies.set(id, async (param) => {
          if (completed == true) {
            return
          }
          await onNotify(param)
        })
      }
      const reply = (param: unknown, error: unknown): boolean => {
        if (completed) {
          return false
        }
        completed = true
        if (error != undefined) {
          reject(error)
        } else {
          resolve(param)
        }
        this.notifies.delete(id)
        this.replies.delete(id)
        if (timer != undefined) {
          clearTimeout(timer)
        }
        disposable?.dispose()
        return true
      }
      this.replies.set(id, reply)
      if (cancelable != undefined) {
        disposable = cancelable.whenCancel(async () => {
          if (reply(undefined, "cancelled")) {
            const m = new Message(Typ.cancel, id)
            this.send?.call(this,m)
          }
        })
      }
      if (timeout > 0) {
        timer = setTimeout(async () => {
          if (reply(undefined, "timedout")) {
            const m = new Message(Typ.cancel, id)
            this.send?.call(this, m)
          }
        }, timeout)
      }
    })
    this.send?.call(this, new Message(Typ.deliver, id, method, param))
    return promise
  }

  async receive(message: Message): Promise<void> {
    switch (message.typ) {
      case Typ.emit:
        {
          const method = message.method
          if (method == undefined) {
            console.log(`[NPC] unhandled message: ${message}`)
            break
          }
          const handle = this.handles.get(method)
          if (handle == undefined) {
            console.log(`[NPC] unhandled message: ${message}`)
            break
          }
          await handle(message.param, new Cancelable(), async (_) => { })
        }
        break
      case Typ.deliver:
        {

          const method = message.method
          if (method == undefined) {
            console.log(`[NPC] unhandled message: ${message}`)
            break
          }
          const id = message.id
          const handle = this.handles.get(method)
          if (handle == undefined) {
            console.log(`[NPC] unhandled message: ${message}`)
            const m = new Message(Typ.ack, id, undefined, undefined, "unimplemented")
            this.send?.call(this, m)
            break
          }
          let completed = false
          const notify = async (param: unknown) => {
            if (completed) {
              return
            }
            const m = new Message(Typ.notify, id, undefined, param)
            this.send?.call(this, m)
          }
          const reply = async (param: unknown, error: unknown): Promise<void> => {
            if (completed) {
              return
            }
            completed = true
            this.cancels.delete(id)
            const m = new Message(Typ.ack, id, undefined, param, error)
            this.send?.call(this, m)
          }
          try {
            const cancelable = new Cancelable()
            this.cancels.set(id, () => {
              if (completed) {
                return
              }
              completed = true
              this.cancels.delete(id)
              cancelable.cancel()
            })
            const r = await handle(message.param, cancelable, notify)
            await reply(r, undefined)
          } catch (e) {
            await reply(undefined, e)
          }
        }
        break
      case Typ.ack:
        {
          this.replies.get(message.id)?.call(this, message.param, message.error)
        }
        break
      case Typ.notify:
        {
          await this.notifies.get(message.id)?.call(this, message.param)
        }
        break
      case Typ.cancel:
        {
          this.cancels.get(message.id)?.call(this)
        }
        break
      default:
        break
    }
  }



  private nextId(): number {
    if (this.id < 2147483647) {
      this.id++
    } else {
      this.id = -2147483647
    }
    return this.id
  }
  private id = -2147483648
  private send: Send | null = null
  private readonly cancels = new Map<number, () => void>()
  private readonly replies = new Map<number, (param: unknown, error: unknown) => boolean>()
  private readonly notifies = new Map<number, Notify>()
  private readonly handles = new Map<string, Handle>()
}
