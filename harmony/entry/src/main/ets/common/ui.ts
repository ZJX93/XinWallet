/**
 * 轻量 UI 反馈工具。
 *
 * 存在原因：`promptAction.showToast` 在新版 SDK 已标记 deprecated，
 * 各页面直接调用会散落一堆告警，且未来 API 移除时要改十几处。
 * 统一收口到这里，只在这一个文件里承担迁移成本。
 */
import promptAction from '@ohos.promptAction';

/** 短提示（约 2s）。失败时降级到 console，不抛异常打断业务流程。 */
export function toast(message: string): void {
  if (!message) {
    return;
  }
  try {
    promptAction.showToast({ message: message, duration: 2000 });
  } catch (e) {
    console.error('toast failed: ' + message);
  }
}

/** 长提示（约 3.5s），用于失败原因等需要多看两眼的信息。 */
export function toastLong(message: string): void {
  if (!message) {
    return;
  }
  try {
    promptAction.showToast({ message: message, duration: 3500 });
  } catch (e) {
    console.error('toast failed: ' + message);
  }
}
