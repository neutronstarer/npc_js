import { Cancelable, Disposable } from "@neutronstarer/cancelable"

/// [NPC] Near Procedure Call
export class NPC {
  /// If [send] is null, you should extends NPC and override send().
  /// [send] Send message function
  constructor(send?: Send) {
    if (send != undefined) {
      this.sendMessage = send
      return
    }
    this.sendMessage = this.send
  }
  /// close with [reason]
  close(reason?: unknown){
    this.cancels.forEach((v)=>{
      v()
    })
    this.replies.forEach((v)=>{
      v(undefined,reason)
    })
  }
  /// handle method
  on(method: string, handle: Handle) {
    this.handles.set(method, handle)
  }
  /// emit method 
  async emit(method: string, param: unknown) {
    await this.sendMessage(new Message(Typ.emit, undefined, method, param))
  }

  async deliver<T>(method: string, param?: unknown, timeout: number = 0, cancelable?: Cancelable, onNotify?: Notify): Promise<T> {
    const id = this.id++
    let resolve: (value: T) => void
    let reject: (value?: unknown) => void
    let completed = false
    let timer: any
    let disposable: Disposable
    const promise = new Promise<T>((rs, rj) => {
      resolve = rs
      reject = rj
    })
    if (onNotify != undefined) {
      this.notifies.set(id, onNotify)
    }
    const reply = (param: unknown, error: unknown): boolean => {
      if (completed) {
        return false
      }
      completed = true
      if (error != undefined) {
        reject(error)
      } else {
        resolve(param as T)
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
          await this.sendMessage(new Message(Typ.cancel, id))
        }
      })
    }
    if (timeout > 0) {
      timer = setTimeout(async () => {
        if (reply(undefined, "timedout")) {
          await this.sendMessage(new Message(Typ.cancel, id))
        }
      }, timeout)
    }
    await this.sendMessage(new Message(Typ.deliver, id, method, param))
    return promise
  }

  async send(message: Message): Promise<void> {
    
  }

  async receive(message: Message): Promise<void> {
    switch (message.typ) {
      case Typ.emit:
        {
          const method = message.method
          if (method == undefined) {
            break
          }
          const handle = this.handles.get(method)
          if (handle == undefined) {
            break
          }
          await handle(message.param, new Cancelable(), async (_) => { })
        }
        break
      case Typ.deliver:
        {
          const id = message.id
          if (id == undefined) {
            break
          }
          const method = message.method
          if (method == undefined) {
            break
          }
          const handle = this.handles.get(method)
          if (handle == undefined) {
            await this.sendMessage(new Message(Typ.ack, id, undefined, undefined, "unimplemented"))
            break
          }
          let completed = false
          const reply = async (param: unknown, error: unknown): Promise<void> => {
            if (completed) {
              return
            }
            completed = true
            this.cancels.delete(id)
            await this.sendMessage(new Message(Typ.ack, id, undefined, param, error))
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
            const r = await handle(message.param, cancelable, async (param: unknown) => {
              if (completed) {
                return
              }
              await this.sendMessage(new Message(Typ.notify, id, undefined, param))
            })
            await reply(r, undefined)
          } catch (e) {
            await reply(undefined, e)
          }
        }
        break
      case Typ.ack:
        {
          const id = message.id
          if (id == undefined) {
            break
          }
          const reply = this.replies.get(id)
          if (reply == undefined) {
            break
          }
          reply(message.param, message.error)
        }
        break
      case Typ.notify: {
        const id = message.id
        if (id == undefined) {
          break
        }
        const notify = this.notifies.get(id)
        if (notify == undefined) {
          break
        }
        await notify(message.param)
      }
        break
      case Typ.cancel:
        {
          const id = message.id
          if (id == undefined) {
            break
          }
          const cancel = this.cancels.get(id)
          if (cancel == undefined) {
            break
          }
          cancel()
        }
        break
      default:
        break
    }
  }
  
  private id = 0
  private readonly sendMessage: Send
  private readonly cancels = new Map<number, () => void>()
  private readonly replies = new Map<number, (param: unknown, error: unknown) => boolean>()
  private readonly notifies = new Map<number, Notify>()
  private readonly handles = new Map<string, Handle>()
}


export class Message {
  constructor(typ: Typ, id?: number, method?: string, param?: unknown, error?: unknown) {
    this.typ = typ
    this.id = id
    this.method = method
    this.param = param
    this.error = error
  }
  readonly typ: Typ
  readonly id?: number
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

export type Notify = (param: unknown) => Promise<void>

export type Handle = (param: unknown, cancelable: Cancelable, notify: Notify) => Promise<unknown>

export type Send = (message: Message) => Promise<void>

export {Cancelable, Disposable}
