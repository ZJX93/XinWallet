/**
 * 录音工具：使用鸿蒙原生 @ohos.multimedia.audio AudioCapturer 录制麦克风，
 * 封装为 WAV(base64) 交给后端 /ai/transcribe（Whisper）转写。
 * 完全不依赖 GMS SpeechRecognizer —— 根治华为无 GMS 机型「语音识别超时」问题。
 *
 * 注意：AudioCapturer 需麦克风权限 ohos.permission.MICROPHONE（已在 module.json5 声明），
 * 真机首次会弹权限请求。本文件按 HarmonyOS NEXT API12 规范编写，需在真机/模拟器联调验证。
 */
import audio from '@ohos.multimedia.audio';
import fs from '@ohos.file.fs';
import buffer from '@ohos.buffer';

const SAMPLE_RATE = 16000;
const CHANNELS = 1;
const BITS = 16;

let capturer: audio.AudioCapturer | null = null;
let fileStream: fs.File | null = null;
let filePath: string = '';
let pcmSize: number = 0;

function writeStr(dv: DataView, off: number, s: string): void {
  for (let i = 0; i < s.length; i++) dv.setUint8(off + i, s.charCodeAt(i));
}

function buildWavHeader(dataSize: number): ArrayBuffer {
  const header = new ArrayBuffer(44);
  const dv = new DataView(header);
  writeStr(dv, 0, 'RIFF');
  dv.setUint32(4, 36 + dataSize, true);
  writeStr(dv, 8, 'WAVE');
  writeStr(dv, 12, 'fmt ');
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);                 // PCM
  dv.setUint16(22, CHANNELS, true);
  dv.setUint32(24, SAMPLE_RATE, true);
  dv.setUint32(28, SAMPLE_RATE * CHANNELS * (BITS / 8), true);
  dv.setUint16(32, CHANNELS * (BITS / 8), true);
  dv.setUint16(34, BITS, true);
  writeStr(dv, 36, 'data');
  dv.setUint32(40, dataSize, true);
  return header;
}

export async function startRecord(path: string): Promise<void> {
  filePath = path;
  pcmSize = 0;
  const options: audio.AudioCapturerOptions = {
    streamInfo: {
      samplingRate: SAMPLE_RATE,
      channels: audio.AudioChannel.CHANNEL_1,
      sampleFormat: audio.AudioSampleFormat.SAMPLE_FORMAT_S16LE,
      encodingType: audio.AudioEncodingType.ENCODING_TYPE_RAW
    },
    capturerInfo: {
      source: audio.SourceType.SOURCE_TYPE_MIC,
      capturerFlags: 0
    }
  };
  capturer = await audio.createAudioCapturer(options);
  fileStream = fs.openSync(path, fs.OpenMode.CREATE | fs.OpenMode.WRITE_ONLY | fs.OpenMode.TRUNC);
  // 先写 44 字节占位头，PCM 从偏移 44 开始
  fs.writeSync(fileStream.fd, buildWavHeader(0));
  capturer.on('readData', (data: ArrayBuffer) => {
    if (data && data.byteLength > 0 && fileStream) {
      fs.writeSync(fileStream.fd, data, { offset: 44 + pcmSize });
      pcmSize += data.byteLength;
    }
  });
  await capturer.start();
}

export async function stopRecord(): Promise<string> {
  if (capturer) {
    try { await capturer.stop(); await capturer.release(); } catch (e) { /* 资源释放失败无补救手段，也不该阻断后续流程 */ }
    capturer = null;
  }
  if (fileStream) {
    // 回写正确的 WAV 头
    fs.writeSync(fileStream.fd, buildWavHeader(pcmSize), { offset: 0 });
    fs.closeSync(fileStream.fd);
    fileStream = null;
  }
  // 读全文件为 base64
  const stat = fs.statSync(filePath);
  const f = fs.openSync(filePath, fs.OpenMode.READ_ONLY);
  const buf = new ArrayBuffer(stat.size);
  fs.readSync(f.fd, buf);
  fs.closeSync(f);
  return buffer.from(buf).toString('base64');
}
