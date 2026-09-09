/**
 * 共享 WebSocket 测试桩，供 client / useWebSocket 测试复用。
 * 模拟真实 WebSocket 的最小接口：readyState、事件回调、send、close。
 */
export class FakeWebSocket {
  static OPEN = 1;
  static instances: FakeWebSocket[] = [];

  readyState = 0;
  closed = false;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  sent: string[] = [];

  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.closed = true;
    this.readyState = 0;
  }
}
