import { Cancelable, Disposable } from "@neutronstarer/cancelable"

export { Cancelable, Disposable }

export class NPC {
  constructor(send?: Send | undefined) {
    if (send != undefined) {
      this._send = send
      return
    }
    this._send = this.send
  }

  on(method: string, handle: Handle) {
    this._handles.set(method, handle)
  }

  async emit(method: string, param: any|undefined = undefined) {
    await this._send(new MessageImpl(Typ.emit, undefined, method, param))
  }

  async deliver(method: string, param: any|undefined = undefined, timeout: number|undefined = 0, cancelable: Cancelable | undefined = undefined, onNotify: Notify | undefined = undefined): Promise<any> {
    const id = this._id++
    let resolve: (value: any) => void
    let reject: (value?: any) => void
    let completed = false
    let timer: any = undefined
    let disposable: Disposable | undefined = undefined
    const promise = new Promise<any>((rs, rj) => {
      resolve = rs
      reject = rj
    })
    if (onNotify != undefined) {
      this._notifies.set(id, onNotify)
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
      this._notifies.delete(id)
      this._replies.delete(id)
      if (timer != undefined) {
        clearTimeout(timer)
      }
      if (disposable != undefined) {
        disposable.dispose()
      }
      return true
    }
    this._replies.set(id, reply)
    if (cancelable != undefined) {
      disposable = cancelable.whenCancel(async () => {
        if (reply(undefined, "cancelled")) {
          await this._send(new MessageImpl(Typ.cancel, id))
        }
      })
    }
    if (timeout > 0) {
      timer = setTimeout(async () => {
        if (reply(undefined, "timedout")) {
          await this._send(new MessageImpl(Typ.cancel, id))
        }
      }, timeout)
    }
    await this._send(new MessageImpl(Typ.deliver, id, method, param))
    return promise
  }

  async send(message: Message): Promise<void> {
    this._(message)
  }

  async receive(message: Message): Promise<void> {
    switch (message.typ) {
      case Typ.emit:
        {
          const method = message.method
          if (method == undefined) {
            break
          }
          const handle = this._handles.get(method)
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
          const handle = this._handles.get(method)
          if (handle == undefined) {
            await this._send(new MessageImpl(Typ.ack, id, undefined, undefined, "unimplemented"))
            break
          }
          let completed = false
          const reply = async (param: any|undefined, error: any|undefined): Promise<void> => {
            if (completed) {
              return
            }
            completed = true
            this._cancels.delete(id)
            await this._send(new MessageImpl(Typ.ack, id, undefined, param, error))
          }
          try {
            const cancelable = new Cancelable()
            this._cancels.set(id, () => {
              if (completed) {
                return
              }
              completed = true
              this._cancels.delete(id)
              cancelable.cancel()
            })
            const r = await handle(message.param, cancelable, async (param: any) => {
              if (completed) {
                return
              }
              await this._send(new MessageImpl(Typ.notify, id, undefined, param))
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
          const reply = this._replies.get(id)
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
        const notify = this._notifies.get(id)
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
          const cancel = this._cancels.get(id)
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

  private _(_: any): void {

  }
  private _send: Send
  private _id = 0
  private _cancels = new Map<number, () => void>()
  private _replies = new Map<number, (param: any|undefined, error: any|undefined) => boolean>()
  private _notifies = new Map<number, Notify>()
  private _handles = new Map<string, Handle>()
}

export enum Typ {
  emit = 0,
  deliver = 1,
  notify = 2,
  ack = 3,
  cancel = 4
}

export interface Message {
  typ: Typ
  id: number | undefined
  method: string | undefined
  param: any
  error: any
}

export type Notify = (param: any|undefined) => Promise<void>

export type Handle = (param: any|undefined, cancelable: Cancelable, notify: Notify) => Promise<any>

export type Send = (message: Message) => Promise<void>

class MessageImpl implements Message {
  constructor(typ: Typ, id: number | undefined = undefined, method: string | undefined = undefined, param: any = undefined, error: any = undefined) {
    this.typ = typ
    this.id = id
    this.method = method
    this.param = param
    this.error = error
  }
  typ: Typ
  id: number | undefined
  method: string | undefined
  param: any
  error: any
}
