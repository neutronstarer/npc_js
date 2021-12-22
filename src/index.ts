import { Cancelable, Disposable } from "@neutronstarer/cancelable"

export class NPC {
  constructor(send?: Send | undefined) {
    if (send != undefined) {
      this.sendMessage = send
      return
    }
    this.sendMessage = this.send
  }

  on(method: string, handle: Handle) {
    this.handles.set(method, handle)
  }

  async emit(method: string, param: any|undefined = undefined) {
    await this.sendMessage(new Message(Typ.emit, undefined, method, param))
  }

  async deliver<T>(method: string, param: any|undefined = undefined, timeout: number|undefined = 0, cancelable: Cancelable | undefined = undefined, onNotify: Notify | undefined = undefined): Promise<T> {
    const id = this.id++
    let resolve: (value: any) => void
    let reject: (value?: any) => void
    let completed = false
    let timer: any = undefined
    let disposable: Disposable | undefined = undefined
    const promise = new Promise<T>((rs, rj) => {
      resolve = rs
      reject = rj
    })
    if (onNotify != undefined) {
      this.notifies.set(id, onNotify)
    }
    const reply = (param: any = undefined, error: any = undefined): boolean => {
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
      if (disposable != undefined) {
        disposable.dispose()
      }
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
    this._send(message)
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
          await handle(message.param, new Cancelable(), async (_: any) => { })
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
          const reply = async (param: any|undefined, error: any|undefined): Promise<void> => {
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
            const r = await handle(message.param, cancelable, async (param: any) => {
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

  private _send(_: any): void {

  }
  
  private id = 0
  private readonly sendMessage: Send
  private readonly cancels = new Map<number, () => void>()
  private readonly replies = new Map<number, (param: any|undefined, error: any|undefined) => boolean>()
  private readonly notifies = new Map<number, Notify>()
  private readonly handles = new Map<string, Handle>()
}


export class Message {
  constructor(typ: Typ, id: number | undefined = undefined, method: string | undefined = undefined, param: any = undefined, error: any = undefined) {
    this.typ = typ
    this.id = id
    this.method = method
    this.param = param
    this.error = error
  }
  readonly typ: Typ
  readonly id: number | undefined
  readonly method: string | undefined
  readonly param: any
  readonly error: any
}

export enum Typ {
  emit = 0,
  deliver = 1,
  notify = 2,
  ack = 3,
  cancel = 4
}

export type Notify = (param: any|undefined) => Promise<void>

export type Handle = (param: any|undefined, cancelable: Cancelable, notify: Notify) => Promise<any>

export type Send = (message: Message) => Promise<void>
