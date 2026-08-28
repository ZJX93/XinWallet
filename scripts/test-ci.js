/* ============================================
  鑫钱包 · CI 测试运行器（逐文件 + 单文件超时）
  ------------------------------------------------------------
  为什么不用 `node --test "test/*.test.js"` 直接跑：

  1. node --test 默认没有单测超时（--test-timeout=Infinity），
     任何一个 await 永久挂起（连接池耗尽 / MySQL 元数据锁等待）
     都会让整个 job 静默挂到 6 小时超时，日志里看不出卡在哪。
  2. 全部文件跑在同一个调度里，某个文件泄漏句柄（数据库连接池
     未 end）会让进程在所有用例通过后仍不退出，同样表现为"挂起"。

  本脚本逐文件起独立子进程：
  - 单文件超过 FILE_TIMEOUT_MS 强制 SIGKILL，并记为失败；
  - 挂起/失败的文件通过 ::error:: 注解暴露到 check run，
    即便整体 job 失败也能一眼定位到具体文件；
  - 每个文件独立进程，A 文件泄漏句柄不会拖死 B 文件。
  ============================================ */
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const TEST_DIR = path.join(ROOT, 'test');
const FILE_TIMEOUT_MS = parseInt(process.env.CI_FILE_TIMEOUT_MS || '120000', 10);

function runFile(file) {
  return new Promise((resolve) => {
    const args = ['--test', '--test-reporter=tap', path.join('test', file)];
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
      resolve({ file, ok: false, reason: 'spawn error: ' + err.message, output });
    });

    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (killed) {
        resolve({ file, ok: false, reason: `超时 ${FILE_TIMEOUT_MS}ms 未完成（已强制 kill）`, output });
        return;
      }
      if (code === 0) {
        resolve({ file, ok: true, reason: '', output });
        return;
      }
      resolve({ file, ok: false, reason: `退出码 ${code}${signal ? ' / signal ' + signal : ''}`, output });
    });
  });
}

// 从 TAP 输出里提取 pass/fail/skip 计数，失败时给出更精确的摘要
function summarizeTap(output) {
  const m = output.match(/^# (pass|fail|skip|cancelled|todo)\s+(\d+)/gim);
  if (!m) return '';
  return m.map((line) => line.replace(/^#\s*/i, '').trim()).join(', ');
}

async function main() {
  if (!fs.existsSync(TEST_DIR)) {
    console.error(`测试目录不存在: ${TEST_DIR}`);
    process.exit(1);
  }

  const files = fs.readdirSync(TEST_DIR)
    .filter((f) => f.endsWith('.test.js'))
    .sort();

  console.log(`[test-ci] 共 ${files.length} 个测试文件，单文件超时 ${FILE_TIMEOUT_MS}ms`);

  const failures = [];
  for (const file of files) {
    const started = Date.now();
    console.log(`\n[test-ci] === ${file}`);
    const res = await runFile(file);
    const cost = Date.now() - started;
    if (res.ok) {
      console.log(`[test-ci] --- ${file} OK (${cost}ms)`);
    } else {
      console.log(`[test-ci] !!! ${file} FAILED (${cost}ms): ${res.reason}`);
      failures.push({ ...res, cost });
    }
  }

  console.log('\n================ [test-ci] 汇总 ================');
  console.log(`通过 ${files.length - failures.length}/${files.length}，失败 ${failures.length}`);
  for (const f of failures) {
    const stats = summarizeTap(f.output);
    const detail = `test/${f.file}: ${f.reason}${stats ? ' | ' + stats : ''} (${f.cost}ms)`;
    // 注解会进入 check run 的 annotations，CI 页面与 API 均可直接看到
    console.log(`::error file=test/${f.file},title=测试文件失败::${detail}`);
  }

  process.exit(failures.length ? 1 : 0);
}

main().catch((err) => {
  console.error('[test-ci] 运行器自身异常:', err);
  process.exit(1);
});
