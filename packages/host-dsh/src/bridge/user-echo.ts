/**
 * 用户消息"回声"去重。
 *
 * 背景：`session.send` 为了低延迟会**乐观广播**一条 `message.user`；
 * 随后 dsh 把同一条消息记进会话日志，bridge 又会翻译出第二条
 * → 前端每条消息渲染两次（实测：ts 相差 16ms 的两条 message.user）。
 *
 * 做法：发送时登记 message id，bridge 遇到同 id 的 `user/message` 时丢弃。
 * 纯函数 + 有界内存（TTL + 上限），无 IO，便于测试。
 *
 * @module @dsh-cursorkit/host-dsh/bridge/user-echo
 */

/** 登记项存活时间（超过则视为陈旧，避免无限增长）。 */
export const ECHO_TTL_MS = 60_000;
/** 登记表上限。 */
export const ECHO_MAX = 200;

const echoed = new Map<string, number>();

/** 发送时登记：该用户消息已由乐观事件发出。 */
export function noteEchoedUserMessage(id: string | undefined, now = Date.now()): void {
  if (!id) return;
  echoed.set(id, now);
  if (echoed.size > ECHO_MAX) {
    for (const [k, t] of echoed) {
      if (now - t > ECHO_TTL_MS) echoed.delete(k);
    }
    // 仍然超限 → 丢弃最旧的
    while (echoed.size > ECHO_MAX) {
      const oldest = echoed.keys().next().value;
      if (oldest === undefined) break;
      echoed.delete(oldest);
    }
  }
}

/**
 * bridge 查询：该 user/message 是否已由乐观事件发出过（是则应丢弃）。
 * 命中后即消费（同一条只可能到达一次）。
 */
export function consumeEchoedUserMessage(id: string | undefined, now = Date.now()): boolean {
  if (!id) return false;
  const t = echoed.get(id);
  if (t === undefined) return false;
  echoed.delete(id);
  return now - t <= ECHO_TTL_MS;
}

/** 仅测试用：清空登记表。 */
export function resetEchoRegistry(): void {
  echoed.clear();
}
