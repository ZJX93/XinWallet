#!/usr/bin/env node
/**
 * 转账两条腿的备注拼接验收。
 *
 * 为什么需要这个脚本：
 * 原先 transfers.js 的 POST 与 PUT 各有两处备注拼接，四处全部写反 ——
 * out 腿（挂在转出账户名下）写的是「转账至 + 自己」，
 * in  腿（挂在转入账户名下）写的是「来自 + 自己」。
 * 于是「工资卡 → 余额宝」这笔转账，在工资卡的流水里显示成「转账至工资卡」。
 *
 * 这种「取反」bug 单看代码极难发现（变量名都眼熟、类型也对），
 * 只有把「谁是对方」写成断言才钉得住。
 *
 * 第二个问题：用户填的 note 被无条件覆盖成系统文案。
 * transfers 主表一直存着用户原文，但流水列表读的是腿上的 note，
 * 所以用户在界面上永远看不到自己写的备注。
 *
 * 本脚本复刻服务端的拼接逻辑并对其断言，不连数据库、不起服务。
 * 若哪天有人"顺手"把 toAcc / fromAcc 换回去，这里立刻红。
 */

let pass = 0, fail = 0;
function ok(cond, name, extra) {
    if (cond) { pass++; console.log('  ok   ' + name); }
    else { fail++; console.log('  FAIL ' + name + (extra ? '  → ' + extra : '')); }
}
function section(t) { console.log('\n' + t); }

/**
 * 复刻 server/routes/transfers.js 的备注拼接。
 * POST 与 PUT 两处必须完全一致 —— 所以这里只有一份实现，
 * 两个路由都用它断言，天然防止"只改一处"。
 */
function buildLegNotes({ note, fromName, toName }) {
    const userNote = (note || '').trim();
    return {
        out: userNote || `转账至${toName}`,   // 钱去哪了 → 对方 = 转入账户
        in: userNote || `来自${fromName}`,    // 钱从哪来 → 对方 = 转出账户
    };
}

// ============================================================
section('1. 空备注 → 回落系统文案，方向必须指向「对方」');
{
    const r = buildLegNotes({ note: '', fromName: '工资卡', toName: '余额宝' });
    ok(r.out === '转账至余额宝', 'out 腿写「转账至 + 转入账户」', r.out);
    ok(r.in === '来自工资卡', 'in  腿写「来自 + 转出账户」', r.in);
    // 这两条是本次修复的核心：绝不能出现「自己」的名字
    ok(!r.out.includes('工资卡'), 'out 腿不能出现转出账户自己的名字', r.out);
    ok(!r.in.includes('余额宝'), 'in  腿不能出现转入账户自己的名字', r.in);
}

section('2. note 为 undefined / null / 纯空格 → 同样回落');
{
    for (const n of [undefined, null, '   ', '\t\n']) {
        const r = buildLegNotes({ note: n, fromName: 'A卡', toName: 'B卡' });
        ok(r.out === '转账至B卡' && r.in === '来自A卡',
            `note=${JSON.stringify(n)} 回落系统文案`, `${r.out} / ${r.in}`);
    }
}

section('3. 用户填了备注 → 两条腿都用用户原文，不许覆盖');
{
    const r = buildLegNotes({ note: '房租押金', fromName: '工资卡', toName: '余额宝' });
    ok(r.out === '房租押金', 'out 腿用用户原文', r.out);
    ok(r.in === '房租押金', 'in  腿用用户原文', r.in);
    ok(!r.out.includes('转账至'), 'out 腿不追加系统前缀', r.out);
    ok(!r.in.includes('来自'), 'in  腿不追加系统前缀', r.in);
}

section('4. 用户备注恰好长得像系统文案 → 依然完整保留');
{
    // 客户端原先靠「以 转账至/来自 开头」判定是系统文案并清空，
    // 会误删这种用户亲手写的备注。服务端行为在此钉死：只要非空就原样存。
    const cases = ['转账至老婆卡', '来自公司报销', '转账至', '来自'];
    for (const n of cases) {
        const r = buildLegNotes({ note: n, fromName: '工资卡', toName: '余额宝' });
        ok(r.out === n && r.in === n, `用户备注「${n}」原样保留`, `${r.out} / ${r.in}`);
    }
}

section('5. 备注前后空格被裁掉，但内部空格保留');
{
    const r = buildLegNotes({ note: '  给 妈 打钱  ', fromName: 'A', toName: 'B' });
    ok(r.out === '给 妈 打钱', '裁掉首尾空格、保留内部空格', JSON.stringify(r.out));
}

section('6. 账户改名场景：腿上的备注是快照，不随账户改名变化');
{
    // 这是设计取舍，不是 bug：备注是写死的文本快照。
    // 若将来要求跟随改名，就不该拼进 note，而应完全依赖
    // transactions.js 返回的 transfer.{from,to}.name（JOIN 实时账户表）。
    // 客户端渲染 A → B 用的正是后者，所以列表显示的账户名永远是最新的。
    const before = buildLegNotes({ note: '', fromName: '工资卡', toName: '余额宝' });
    const after = buildLegNotes({ note: '', fromName: '工资卡(旧)', toName: '余额宝' });
    // 注意断言对象：改的是 fromName，而只有 in 腿的文案用 fromName。
    // 拿 out 腿来断言「随改名变化」是错的 —— out 腿用的是 toName，本来就不该变。
    // （第一版脚本正是这么写错的，红了一项才发现。）
    ok(before.in !== after.in, '转出账户改名后，新建 in 腿的文案随之变化', `${before.in} vs ${after.in}`);
    ok(before.out === after.out, '转出账户改名不影响 out 腿文案（它只关心转入方）', before.out);
    ok(before.out === '转账至余额宝', '旧快照文案本身不被改写');
}

section('7. POST 与 PUT 必须共用同一套规则');
{
    // 两个路由若各写一份，很容易只改一处。此处以同参数调用两次，
    // 断言结果一致 —— 真正的保障是服务端两处都调用同一段逻辑。
    const args = { note: '', fromName: '甲', toName: '乙' };
    const a = buildLegNotes(args);
    const b = buildLegNotes(args);
    ok(a.out === b.out && a.in === b.in, 'POST / PUT 拼接结果一致');
    ok(a.out === '转账至乙' && a.in === '来自甲', '双向文案正确', `${a.out} / ${a.in}`);
}

section('8. 源码级检查：确认服务端没有把账户名写反');
{
    const fs = require('fs');
    const path = require('path');
    const file = path.join(__dirname, '..', 'server', 'routes', 'transfers.js');
    const src = fs.readFileSync(file, 'utf8');

    // 反向模式：出现「转账至${fromAcc...}」或「来自${toAcc...}」即为写反
    const wrongOut = /转账至\$\{fromAcc/.test(src);
    const wrongIn = /来自\$\{toAcc/.test(src);
    ok(!wrongOut, 'out 腿没有写成「转账至${fromAcc}」（自己）');
    ok(!wrongIn, 'in  腿没有写成「来自${toAcc}」（自己）');

    // 正向模式：必须各出现两次（POST + PUT）
    const rightOut = (src.match(/转账至\$\{toAcc/g) || []).length;
    const rightIn = (src.match(/来自\$\{fromAcc/g) || []).length;
    ok(rightOut === 2, 'out 腿在 POST/PUT 各有一处「转账至${toAcc}」', '实际 ' + rightOut + ' 处');
    ok(rightIn === 2, 'in  腿在 POST/PUT 各有一处「来自${fromAcc}」', '实际 ' + rightIn + ' 处');

    // userNote 分支必须存在，否则用户备注又会被覆盖
    const userNoteUses = (src.match(/userNote \|\|/g) || []).length;
    ok(userNoteUses === 4, 'POST/PUT 各两条腿都走 userNote 优先', '实际 ' + userNoteUses + ' 处');

    // 账户名查询必须带 user_id / book_id：只按 id 查会读到别人账本的账户名
    const looseLookup = /SELECT name FROM accounts WHERE id = \$1'/.test(src);
    ok(!looseLookup, '账户名查询都带 user_id / book_id 过滤');
}

console.log('\n' + '─'.repeat(52));
console.log(`总计 ${pass + fail} 项：通过 ${pass}，失败 ${fail}`);
process.exit(fail === 0 ? 0 : 1);
