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
      // 往下扫 YAML 诊断块，取第一行人类可读的错误描述
      let err = '';
      for (let j = i + 1; j < Math.min(i + 25, lines.length); j++) {
        const l = lines[j];
        if (/^\s*(\.\.\.|---)\s*$/.test(l)) continue;
        const m = l.match(/^\s{2,}(.*\S)\s*$/);
        if (!m) continue;
        const text = m[1].trim();
        if (!text) continue;
        if (/^(duration_ms|type|code|failureType|cause|stack|at:)/i.test(text)) continue;
        err = text;
        break;
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

  console.log(`[test-ci] 共 ${files.length} 个测试文件 | 单用例超时 ${CASE_TIMEOUT_MS}ms | 单文件超时 ${FILE_TIMEOUT_MS}ms`);

  const failures = [];
  for (const file of files) {
    const started = Date.now();
    console.log(`\n[test-ci] === ${file}`);
    const res = await runFile(file);
    const cost = Date.now() - started;

    if (res.ok) {
      console.log(`[test-ci] --- ${file} OK (${cost}ms)`);
      continue;
    }

    const { stats, failures: cases } = parseTap(res.output);
    const statText = formatStats(stats);

    // 没有任何失败/取消用例却没能自行退出 —— 典型的句柄泄漏（连接池未关闭）
    const leak = res.killed && (stats.fail || 0) === 0 && (stats.cancelled || 0) === 0;
    const kind = leak ? 'HANDLE-LEAK' : (res.killed ? 'TIMEOUT' : 'FAILED');

    console.log(`[test-ci] !!! ${file} ${kind} (${cost}ms): ${res.reason} | ${statText || 'no TAP stats'}`);
    failures.push({ ...res, cost, stats, cases, statText, kind, leak });
  }

  console.log('\n================ [test-ci] 汇总 ================');
  console.log(`通过 ${files.length - failures.length}/${files.length}，失败 ${failures.length}`);

  for (const f of failures.slice(0, MAX_ANNOTATIONS)) {
    const head = `[${f.kind}] test/${f.file}: ${f.reason} | ${f.statText || 'no TAP stats'} (${f.cost}ms)`;
    const detail = f.cases.length
      ? ' | 用例: ' + f.cases.slice(0, 3).map((c) => `${c.name}${c.err ? ' → ' + truncate(c.err, 300) : ''}`).join(' ;; ')
      : (f.leak ? ' | 所有用例均通过但进程未退出，疑似句柄泄漏（连接池未 end / 服务未 close）' : ' | 无 TAP 输出（可能是启动即崩溃或整体超时）');
    console.log(`::error file=test/${f.file},title=${f.kind} test/${f.file}::${truncate(head + detail, 1400)}`);
  }
  if (failures.length > MAX_ANNOTATIONS) {
    console.log(`::error title=更多失败文件::另有 ${failures.length - MAX_ANNOTATIONS} 个失败文件未展示（注解上限 ${MAX_ANNOTATIONS}）`);
  }

  process.exit(failures.length ? 1 : 0);
}

main().catch((err) => {
  console.error('[test-ci] 运行器自身异常:', err);
  process.exit(1);
});
