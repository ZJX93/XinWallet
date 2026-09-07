/* ============================================
  鑫钱包 · CI 测试运行器（逐文件 + 双层超时 + 失败摘要）
  ------------------------------------------------------------
  为什么不直接用 `node --test "test/*.test.js"`：

  1. node --test 默认没有单测超时（--test-timeout=Infinity），
     任何一个 await 永久挂起（数据库连接池耗尽 / MySQL 元数据锁等待）
     都会让整个 job 静默挂到 6 小时超时，且日志里看不出卡在哪。
  2. 全部文件跑在同一个调度里，某个文件泄漏句柄（数据库连接池未 end）
     会让进程在所有用例通过后仍不退出，同样表现为"挂起"。
  3. CI 日志无凭据下载时定位困难，因此把结论写进 ::error:: 注解
     （check run annotations 可通过 API 直接读取），不依赖日志。

  策略：
  - 逐文件起独立子进程，A 文件泄漏句柄不会拖死 B 文件；
  - 双层超时：单用例 CASE_TIMEOUT_MS（由 node --test 标记失败并输出用例名），
    单文件 FILE_TIMEOUT_MS（兜底 SIGKILL，处理"用例都过了但进程不退出"）；
  - 区分两种失败：用例断言失败 vs 全部通过但进程未退出（句柄泄漏）。
  ============================================ */
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const TEST_DIR = path.join(ROOT, 'test');

// 自执行验证脚本（IIFE / main() + process.exitCode，非 node:test 的 test() 风格）。
// 这两个「备份导出导入端到端」与「xlsx 解析」脚本长期游离在 CI 之外
// （原先只扫 test/*.test.js），这里纳入 CI，防止 INSERT 列名与 schema 漂移、
// 或 xlsx 结构变更后无人发现。
const PLAIN_SCRIPTS = [
  path.join('scripts', 'test-backup-xlsx.js'),
  path.join('scripts', 'test-backup-routes.js'),
];

const FILE_TIMEOUT_MS = parseInt(process.env.CI_FILE_TIMEOUT_MS || '150000', 10);
const CASE_TIMEOUT_MS = parseInt(process.env.CI_CASE_TIMEOUT_MS || '60000', 10);
// GitHub 每个 step 最多保留 10 条 error/warning 注解，多余会被丢弃
const MAX_ANNOTATIONS = 8;

function runFile(file) {
  return new Promise((resolve) => {
    const args = [
      '--test',
      '--test-reporter=tap',
      `--test-timeout=${CASE_TIMEOUT_MS}`,
      path.join('test', file),
    ];
    const child = spawn(process.execPath, args, {
      cwd: ROOT,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let output = '';
    let killed = false;

    const timer = setTimeout(() => {
      killed = true;
      child.kill('SIGKILL');
    }, FILE_TIMEOUT_MS);

    const onData = (buf) => {
      const text = buf.toString();
      output += text;
      process.stdout.write(text);
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ file, ok: false, killed: false, code: null, output, reason: 'spawn error: ' + err.message });
    });

    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({
        file,
        ok: code === 0 && !killed,
        killed,
        code,
        output,
        reason: killed
          ? `文件级超时 ${FILE_TIMEOUT_MS}ms（已 SIGKILL）`
          : `退出码 ${code}${signal ? ' / signal ' + signal : ''}`,
      });
    });
  });
}

// 运行「自执行脚本」：不用 node --test —— 它们不是 test() 风格、输出也不是 TAP，
// 直接起 node 执行并以退出码作为结论；同样套用文件级超时兜底
//（test-backup-routes 会 listen 一个临时端口，最坏情况下进程可能不退出）。
function runPlainScript(relPath) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [relPath], {
      cwd: ROOT,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let output = '';
    let killed = false;

    const timer = setTimeout(() => {
      killed = true;
      child.kill('SIGKILL');
    }, FILE_TIMEOUT_MS);

    const onData = (buf) => {
      const text = buf.toString();
      output += text;
      process.stdout.write(text);
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ file: relPath, ok: false, killed: false, code: null, output, reason: 'spawn error: ' + err.message });
    });

    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({
        file: relPath,
        ok: code === 0 && !killed,
        killed,
        code,
        output,
        reason: killed
          ? `文件级超时 ${FILE_TIMEOUT_MS}ms（已 SIGKILL）`
          : `退出码 ${code}${signal ? ' / signal ' + signal : ''}`,
      });
    });
  });
}

// 解析 TAP：统计行 + 失败/取消的用例名及其首行错误信息
function parseTap(output) {
  const lines = output.split(/\r?\n/);
  const stats = {};
  const failures = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const stat = line.match(/^#\s+(tests|pass|fail|cancelled|skipped|todo|skipped_todo)\s+(\d+)\s*$/i);
    if (stat) {
      stats[stat[1].toLowerCase()] = parseInt(stat[2], 10);
      continue;
    }

    const notOk = line.match(/^\s*not ok\s+(\d+)\s*-\s*(.*)$/);
    if (notOk) {
      // 往下扫 YAML 诊断块，取断言错误正文（跳过 location/duration_ms 等元信息）
      let err = '';
      let inErrorBlock = false;
      for (let j = i + 1; j < Math.min(i + 40, lines.length); j++) {
        const l = lines[j];
        if (/^\s*(\.\.\.|---)\s*$/.test(l)) continue;
        const m = l.match(/^\s{2,}(.*\S)\s*$/);
        if (!m) { if (inErrorBlock && err) break; continue; }
        const text = m[1].trim();
        if (!text) continue;
        if (/^(duration_ms|type|code|failureType|cause|stack|at:|location)/i.test(text)) continue;
        if (/^error:\s*\|?\s*$/.test(text)) { inErrorBlock = true; continue; }
        if (/^error:\s*\S/.test(text)) { err = text.replace(/^error:\s*/, ''); break; }
        err = err ? err + ' / ' + text : text;
        if (err.length > 400) break;
      }
      failures.push({ name: notOk[2].trim(), err });
    }
  }

  return { stats, failures };
}

function formatStats(stats) {
  const keys = ['tests', 'pass', 'fail', 'cancelled', 'skipped'];
  return keys.filter((k) => stats[k] !== undefined).map((k) => `${k} ${stats[k]}`).join(', ');
}

function truncate(s, n) {
  const one = s.replace(/\r?\n/g, ' ⏎ ');
  return one.length > n ? one.slice(0, n) + '…' : one;
}

async function main() {
  if (!fs.existsSync(TEST_DIR)) {
    console.error(`测试目录不存在: ${TEST_DIR}`);
    process.exit(1);
  }

  const files = fs.readdirSync(TEST_DIR)
    .filter((f) => f.endsWith('.test.js'))
    .sort();

  const plainScripts = PLAIN_SCRIPTS.filter((p) => fs.existsSync(path.join(ROOT, p)));
  const total = files.length + plainScripts.length;

  console.info(`[test-ci] 共 ${files.length} 个测试文件 + ${plainScripts.length} 个自执行脚本 | 单用例超时 ${CASE_TIMEOUT_MS}ms | 单文件超时 ${FILE_TIMEOUT_MS}ms`);

  const failures = [];
  for (const file of files) {
    const started = Date.now();
    console.info(`\n[test-ci] === ${file}`);
    const res = await runFile(file);
    const cost = Date.now() - started;

    if (res.ok) {
      console.info(`[test-ci] --- ${file} OK (${cost}ms)`);
      continue;
    }

    const { stats, failures: cases } = parseTap(res.output);
    const statText = formatStats(stats);

    // 一条用例都没失败，却要么被文件级超时 kill、要么被 --test-timeout 取消 ——
    // 说明卡点不在断言，而在「进程跑完用不退出」，即句柄泄漏（连接池/定时器/server 未关闭）
    const leak = (stats.fail || 0) === 0 && (res.killed || (stats.cancelled || 0) > 0);
    const kind = leak ? 'HANDLE-LEAK' : (res.killed ? 'TIMEOUT' : 'FAILED');

    console.info(`[test-ci] !!! ${file} ${kind} (${cost}ms): ${res.reason} | ${statText || 'no TAP stats'}`);
    failures.push({ ...res, cost, stats, cases, statText, kind, leak, label: `test/${file}` });
  }

  // 自执行脚本：无 TAP 可解析，退出码即结论
  for (const rel of plainScripts) {
    const started = Date.now();
    console.info(`\n[test-ci] === ${rel}`);
    const res = await runPlainScript(rel);
    const cost = Date.now() - started;

    if (res.ok) {
      console.info(`[test-ci] --- ${rel} OK (${cost}ms)`);
      continue;
    }

    // 自执行脚本用 console.error('❌ ...') 报告失败，从输出里摘几行线索
    const errLines = res.output.trim().split(/\r?\n/)
      .filter((l) => /❌|Error|not ok/i.test(l))
      .slice(0, 3)
      .map((l) => truncate(l.trim(), 200));

    console.info(`[test-ci] !!! ${rel} ${res.killed ? 'TIMEOUT' : 'FAILED'} (${cost}ms): ${res.reason}`);
    failures.push({
      ...res,
      cost,
      stats: {},
      cases: [],
      statText: '',
      kind: res.killed ? 'TIMEOUT' : 'FAILED',
      leak: false,
      label: rel.replace(/\\/g, '/'), // Windows 反斜杠 → 正斜杠，便于注解里定位文件
      detail: errLines.length ? errLines.join(' ;; ') : '无明确错误行（见上方原始输出）',
    });
  }

  console.info('\n================ [test-ci] 汇总 ================');
  console.info(`通过 ${total - failures.length}/${total}，失败 ${failures.length}`);

  for (const f of failures.slice(0, MAX_ANNOTATIONS)) {
    const head = `[${f.kind}] ${f.label}: ${f.reason} | ${f.statText || 'no TAP stats'} (${f.cost}ms)`;
    const detail = f.cases.length
      ? ' | 用例: ' + f.cases.slice(0, 3).map((c) => `${c.name}${c.err ? ' → ' + truncate(c.err, 300) : ''}`).join(' ;; ')
      : (f.leak ? ' | 所有用例均通过但进程未退出，疑似句柄泄漏（连接池未 end / 服务未 close）'
        : (f.detail ? ' | ' + f.detail : ' | 无 TAP 输出（可能是启动即崩溃或整体超时）'));
    console.info(`::error file=${f.label},title=${f.kind} ${f.label}::${truncate(head + detail, 1400)}`);
  }
  if (failures.length > MAX_ANNOTATIONS) {
    console.info(`::error title=更多失败文件::另有 ${failures.length - MAX_ANNOTATIONS} 个失败文件未展示（注解上限 ${MAX_ANNOTATIONS}）`);
  }

  process.exit(failures.length ? 1 : 0);
}

main().catch((err) => {
  console.error('[test-ci] 运行器自身异常:', err);
  process.exit(1);
});
