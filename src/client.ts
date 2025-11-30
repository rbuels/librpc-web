import EventEmitter from './ee'
import { uuid } from './utils'
import { deserializeError } from 'serialize-error'

interface RpcClientOptions {
  /** List of server workers */
  workers: Worker[]
}

interface RpcMessageData {
  /** Remote call uid */
  uid: string
  /** `true` flag */
  libRpc: true
  /** Error description */
  error?: string
  /** Remote procedure name */
  method?: string
  /** Server event name */
  eventName?: string
  /** Procedure result or event data */
  data: any
}


export default class RpcClient extends EventEmitter {
  public workers: Worker[]
  protected idx = 0
  protected calls: Record<string, (data: any) => void> = {}
  protected timeouts: Record<string, NodeJS.Timeout> = {}
  protected errors: Record<string, (error: Error) => void> = {}

  /**
   * Client could be connected to several workers for better CPU utilization.
   * Requests are sent to an exact worker by round robin algorithm.
   * @param options - Rpc Client options
   */
  constructor({ workers }: RpcClientOptions) {
    super()
    this.workers = [...workers]
    this.handler = this.handler.bind(this)
    this.catch = this.catch.bind(this)
    this.init()
  }

  /**
   * Subscribtion to web workers events
   */
  protected init() {
    this.workers.forEach(this.listen, this)
  }

  /**
   * Subsrciption to exact worker
   * @param worker - Server worker
   */
  protected listen(worker: Worker) {
    worker.addEventListener('message', this.handler)
    worker.addEventListener('error', this.catch)
  }

  /**
   * Message handler
   * @param e - Event object
   */
  protected handler(e: MessageEvent<RpcMessageData>) {
    const { uid, error, method, eventName, data, libRpc } = e.data

    if (!libRpc) return // ignore non-librpc messages

    if (error) {
      this.reject(uid, error)
    } else if (method) {
      this.resolve(uid, data)
    } else if (eventName) {
      this.emit(eventName, data)
    }
  }

  /**
   * Error handler
   * https://www.nczonline.net/blog/2009/08/25/web-workers-errors-and-debugging/
   * @param e - Error event
   */
  catch(e: ErrorEvent) {
    this.emit('error', {
      message: e.message,
      lineno: e.lineno,
      filename: e.filename,
    })
  }

  /**
   * Handle remote procedure call error
   * @param uid - Remote call uid
   * @param error - Error message
   */
  protected reject(uid: string, error: string | Error) {
    if (this.errors[uid]) {
      this.errors[uid](deserializeError(error))
      this.clear(uid)
    }
  }

  /**
   * Handle remote procedure call response
   * @param uid - Remote call uid
   * @param data - Response data
   */
  protected resolve(uid: string, data: any) {
    if (this.calls[uid]) {
      this.calls[uid](data)
      this.clear(uid)
    }
  }

  /**
   * Clear inner references to remote call
   * @param uid - Remote call uid
   */
  protected clear(uid: string) {
    clearTimeout(this.timeouts[uid])
    delete this.timeouts[uid]
    delete this.calls[uid]
    delete this.errors[uid]
  }

  /**
   * Remote procedure call.
   * Error would be thrown, if:
   * - it happened during procedure
   * - you try to call an unexisted procedure
   * - procedure execution takes more than timeout
   * @param method - Remote procedure name
   * @param data - Request data
   * @param options - Options (timeout in ms, transferables array)
   * @returns Remote procedure promise
   */
  call(
    method: string,
    data: any,
    { timeout = 2000, transferables = [] }: { timeout?: number; transferables?: Transferable[] } = {},
  ) {
    const uid = uuid()
    return new Promise((resolve, reject) => {
      this.timeouts[uid] = setTimeout(
        () =>
          this.reject(
            uid,
            new Error(`Timeout exceeded for RPC method "${method}"`),
          ),
        timeout,
      )
      this.calls[uid] = resolve
      this.errors[uid] = reject
      this.workers[this.idx].postMessage(
        { method, uid, data, libRpc: true },
        transferables,
      )
      this.idx = ++this.idx % this.workers.length // round robin
    })
  }
}

