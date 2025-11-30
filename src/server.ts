/* eslint-env serviceworker */
import { ErrorObject, serializeError } from 'serialize-error'

interface RpcResult {
  result: unknown
  transferables?: Transferable[]
}

type Procedure = (data: unknown) => Promise<unknown | RpcResult>

/**
 * @callback Procedure
 * @param  {*}           data Any data
 * @return {(Promise|*)}
 */

interface RpcMessageData {
  /** Procedure name */
  method: string
  /** Unique id of rpc call */
  uid: string
  /** True/false flag of whether the message is handled by this library */
  libRpc: true
  /** Procedure params */
  data: unknown
}

function isRpcResult(value: unknown): value is RpcResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    'result' in value &&
    (!('transferables' in value) || Array.isArray(value.transferables))
  )
}

export default class RpcServer {
  protected methods: Record<string, Procedure>

  /**
   * Every passed method becomes remote procedure.
   * It can return Promise if it is needed.
   * Procedures can return either a plain value or { result, transferables }
   * to specify transferable objects explicitly.
   * Errors thrown by procedures would be handled by server.
   * @param methods - Dictionary of remote procedures
   * @example
   *
   * var server = new RpcServer({
   *   add ({ x, y }) { return x + y },
   *   getBuffer () {
   *     const buffer = new ArrayBuffer(1024)
   *     return { result: buffer, transferables: [buffer] }
   *   }
   * })
   */
  constructor(methods: Record<string, Procedure>) {
    this.methods = methods
    this.listen()
  }

  protected listen() {
    self.addEventListener('message', this.handler.bind(this))
  }

  protected handler(e: MessageEvent<RpcMessageData>) {
    const { libRpc, method, uid, data } = e.data

    if (!libRpc) {
      return
    }

    const methodFn = this.methods[method]
    if (methodFn) {
      Promise.resolve(data)
        .then(methodFn)
        .then(
          response => this.reply(uid, method, response),
          error => this.throw(uid, serializeError(error)),
        )
    } else {
      this.throw(uid, `Unknown RPC method "${method}"`)
    }
  }

  protected reply(uid: string, method: string, response: unknown) {
    try {
      if (isRpcResult(response)) {
        const { result, transferables = [] } = response
        self.postMessage({ uid, method, data: result, libRpc: true }, transferables)
      } else {
        self.postMessage({ uid, method, data: response, libRpc: true })
      }
    } catch (e) {
      this.throw(uid, serializeError(e))
    }
  }

  protected throw(uid: string, error: ErrorObject | string) {
    self.postMessage({ uid, error, libRpc: true })
  }

  /**
   * Trigger server event
   * @param eventName - Event name
   * @param data - Any data
   * @param transferables - Optional array of transferable objects
   */
  emit(eventName: string, data: unknown, transferables: Transferable[] = []) {
    self.postMessage({ eventName, data, libRpc: true }, transferables)
  }
}

