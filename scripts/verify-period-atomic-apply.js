#!/usr/bin/env node
/**
 * 验收：报表页周期切换必须「原子提交」——mode 与 period 一次赋值、一次请求。
 *
 * 背景
 * ----
 * 鸿蒙走单一入口 applyPeriod(period, mode)：
 *     this.periodMode = mode; this.period = period; this.load();
 *
 * 安卓原来是两段式：
 *     vm.setPeriodMode(mode); vm.setPeriod(period)
 * 而两个 setter 各自带去重 guard 且各自 loadReport()。
 *
 * 这个脚本把两种实现都跑一遍同样的用户操作序列，对比
 *   1) 最终 (periodMode, period) 是否正确
 *   2) 发出了几次请求、每次请求的参数是什么
 *
 * 判据：任何一次「中间态请求」都是真实缺陷 —— 它带着旧 mode + 新 period
 * （或反之）打到服务端，要么白耗一次往返，要么把错误区间的数据渲染出来。
 */

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.info(`  ✓ ${name}`); }
  else { fail++; console.info(`  ✗ ${name}${extra ? '  → ' + extra : ''}`); }
}
function eq(name, actual, expect) {
  const a = JSON.stringify(actual), e = JSON.stringify(expect);
  ok(name, a === e, `实际 ${a} 期望 ${e}`);
}

const CUR_MONTH = '2026-08';

// ---------- 被测实现 A：安卓「两段式」（修复前） ----------
function makeTwoStep() {
  const st = { periodMode: 'month', period: CUR_MONTH };
  const reqs = [];
  const load = () => reqs.push({
    // 复刻 loadReport 里的 granularity 推导
    gran: st.periodMode === 'year' ? 'annual' : (st.periodMode === 'custom' ? 'custom' : 'monthly'),
    period: st.period
  });
  return {
    st, reqs,
    setPeriodMode(mode) {
      if (mode === st.periodMode) return;            // 去重 guard
      let np;
      if (mode === 'year') np = st.period.slice(0, 4);
      else if (mode === 'custom') np = st.period;
      else np = st.period.length === 4 ? `${st.period}-${CUR_MONTH.slice(5)}` : st.period;
      st.periodMode = mode; st.period = np;
      load();
    },
    setPeriod(period) {
      if (period === st.period) return;              // 去重 guard
      st.period = period;
      load();
    },
    apply(period, mode) { this.setPeriodMode(mode); this.setPeriod(period); }
  };
}

// ---------- 被测实现 B：原子提交（修复后，对齐鸿蒙 applyPeriod） ----------
function makeAtomic() {
  const st = { periodMode: 'month', period: CUR_MONTH };
  const reqs = [];
  return {
    st, reqs,
    apply(period, mode) {
      // 同一个周期同一个维度重复点：不该白发请求
      if (period === st.period && mode === st.periodMode) return;
      st.periodMode = mode; st.period = period;
      reqs.push({
        gran: mode === 'year' ? 'annual' : (mode === 'custom' ? 'custom' : 'monthly'),
        period
      });
    }
  };
}

console.info('\n【1】月 → 年（用户在弹层选「2026年」）');
{
  const two = makeTwoStep();  two.apply('2026', 'year');
  const ato = makeAtomic();   ato.apply('2026', 'year');
  eq('两段式：最终状态正确', [two.st.periodMode, two.st.period], ['year', '2026']);
  eq('原子式：最终状态正确', [ato.st.periodMode, ato.st.period], ['year', '2026']);
  // setPeriodMode 内部已把 period 截成 '2026'，随后 setPeriod('2026') 被 guard 拦掉
  eq('两段式：请求数 1（碰巧对）', two.reqs.length, 1);
  eq('原子式：请求数 1', ato.reqs.length, 1);
  eq('原子式：请求参数', ato.reqs[0], { gran: 'annual', period: '2026' });
}

console.info('\n【2】⛔ 年 → 月（从 2026 切回 2026-03，弹层里选了 3 月）');
{
  const two = makeTwoStep();
  two.apply('2026', 'year');       // 先进年模式
  two.reqs.length = 0;
  two.apply('2026-03', 'month');   // 再切回月，且不是当前月

  const ato = makeAtomic();
  ato.apply('2026', 'year');
  ato.reqs.length = 0;
  ato.apply('2026-03', 'month');

  eq('两段式：最终状态正确', [two.st.periodMode, two.st.period], ['month', '2026-03']);
  eq('原子式：最终状态正确', [ato.st.periodMode, ato.st.period], ['month', '2026-03']);

  // setPeriodMode('month') 把 '2026' 补成当前月 '2026-08' 并发了一次请求，
  // 然后 setPeriod('2026-03') 才发第二次 —— 第一次完全是浪费
  eq('⛔ 两段式：发了 2 次请求', two.reqs.length, 2);
  eq('⛔ 两段式：第 1 次是用户没选的 2026-08', two.reqs[0], { gran: 'monthly', period: '2026-08' });
  eq('两段式：第 2 次才是用户要的', two.reqs[1], { gran: 'monthly', period: '2026-03' });
  eq('✅ 原子式：只发 1 次', ato.reqs.length, 1);
  eq('✅ 原子式：直接就是用户要的', ato.reqs[0], { gran: 'monthly', period: '2026-03' });

  ok('⛔ 两段式存在中间态请求（竞态风险：两次响应乱序回来会渲染 8 月数据）',
    two.reqs.length === 2 && two.reqs[0].period === '2026-08');
}

console.info('\n【3】⛔ 年内换年（2026年 → 2025年，点左箭头）');
{
  const two = makeTwoStep();
  two.apply('2026', 'year');
  two.reqs.length = 0;
  two.apply('2025', 'year');       // mode 没变，period 变了

  const ato = makeAtomic();
  ato.apply('2026', 'year');
  ato.reqs.length = 0;
  ato.apply('2025', 'year');

  eq('两段式：最终状态正确', [two.st.periodMode, two.st.period], ['year', '2025']);
  eq('两段式：请求数 1（mode 未变被 guard 拦掉，靠 setPeriod 兜住）', two.reqs.length, 1);
  eq('两段式：请求参数', two.reqs[0], { gran: 'annual', period: '2025' });
  eq('原子式：请求数 1', ato.reqs.length, 1);
  eq('原子式：请求参数', ato.reqs[0], { gran: 'annual', period: '2025' });
}

console.info('\n【4】⛔ 月 → 自定义（custom 的 period 是区间串）');
{
  const two = makeTwoStep();
  two.apply('2026-01-01~2026-06-30', 'custom');

  const ato = makeAtomic();
  ato.apply('2026-01-01~2026-06-30', 'custom');

  eq('原子式：最终状态正确', [ato.st.periodMode, ato.st.period], ['custom', '2026-01-01~2026-06-30']);
  eq('✅ 原子式：只发 1 次且参数正确', ato.reqs, [{ gran: 'custom', period: '2026-01-01~2026-06-30' }]);

  // setPeriodMode('custom') 分支写的是 np = st.period（保持原值 '2026-08'），
  // 于是先拿「custom + 2026-08」打一次 —— 服务端按区间解析 '2026-08' 必然出错
  eq('⛔ 两段式：发了 2 次请求', two.reqs.length, 2);
  eq('⛔ 两段式：第 1 次是 custom 配月份串（服务端解析不了）',
    two.reqs[0], { gran: 'custom', period: '2026-08' });
  eq('两段式：第 2 次才正确', two.reqs[1], { gran: 'custom', period: '2026-01-01~2026-06-30' });
}

console.info('\n【5】⛔ 自定义 → 月（退出自定义回到某月）');
{
  const two = makeTwoStep();
  two.apply('2026-01-01~2026-06-30', 'custom');
  two.reqs.length = 0;
  two.apply('2026-05', 'month');

  const ato = makeAtomic();
  ato.apply('2026-01-01~2026-06-30', 'custom');
  ato.reqs.length = 0;
  ato.apply('2026-05', 'month');

  eq('原子式：最终状态正确', [ato.st.periodMode, ato.st.period], ['month', '2026-05']);
  eq('✅ 原子式：只发 1 次', ato.reqs, [{ gran: 'monthly', period: '2026-05' }]);

  // setPeriodMode('month')：period 长度 19 不等于 4，走 else 原样保留区间串，
  // 于是「monthly + 2026-01-01~2026-06-30」打一次 —— 月粒度配区间串
  eq('⛔ 两段式：发了 2 次请求', two.reqs.length, 2);
  eq('⛔ 两段式：第 1 次是 monthly 配区间串',
    two.reqs[0], { gran: 'monthly', period: '2026-01-01~2026-06-30' });
}

console.info('\n【6】重复点同一个周期不该发请求');
{
  const ato = makeAtomic();
  ato.apply('2026', 'year');
  const n = ato.reqs.length;
  ato.apply('2026', 'year');    // 再点一次一模一样的
  eq('原子式：重复点不发第二次', ato.reqs.length, n);
}

console.info('\n【7】箭头翻月（月模式内 period 变化）');
{
  const ato = makeAtomic();
  ato.apply('2026-07', 'month');
  ato.apply('2026-06', 'month');
  eq('原子式：两次箭头两次请求', ato.reqs.length, 2);
  eq('原子式：参数依次正确', ato.reqs,
    [{ gran: 'monthly', period: '2026-07' }, { gran: 'monthly', period: '2026-06' }]);
}

console.info('\n【8】granularity 取值必须是旧服务端也认识的集合');
{
  const OLD_SERVER_OK = ['monthly', 'quarterly', 'annual'];
  const ato = makeAtomic();
  ato.apply('2026', 'year');
  ok('按年发 annual（旧服务端认识）', OLD_SERVER_OK.includes(ato.reqs[0].gran),
    ato.reqs[0].gran);
  ok('不再发 yearly', ato.reqs[0].gran !== 'yearly');

  // 注意不能用 '2026-08'/'month' —— 那正好是初始态，会被去重 guard 拦掉、
  // reqs 为空。这是脚本写法陷阱：验「切换后的请求」必须切到一个不同的值。
  const ato2 = makeAtomic();
  ato2.apply('2026-05', 'month');
  ok('按月发 monthly（旧服务端认识）', OLD_SERVER_OK.includes(ato2.reqs[0].gran));

  const ato3 = makeAtomic();
  ato3.apply('2026-01-01~2026-06-30', 'custom');
  ok('custom 旧服务端不认识（需部署，UI 已给明确文案）',
    !OLD_SERVER_OK.includes(ato3.reqs[0].gran), ato3.reqs[0].gran);
}

console.info(`\n${'='.repeat(52)}`);
console.info(`通过 ${pass} / 失败 ${fail}`);
console.info('='.repeat(52));
if (fail > 0) process.exit(1);
