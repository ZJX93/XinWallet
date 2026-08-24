/**
 * HTTP 封装：
 *  - 自动注入 Bearer token 与 X-Book-Id（多账本隔离）
 *  - 401 自动用 refreshToken 刷新并重试一次；刷新失败清会话并抛 ApiError(401)
 *  - 统一解析 { success, data, message } 包装；非 success 抛 ApiError
 *  - raw=true 时直接返回文本（CSV 导出）
 * 依赖：config.normalizeBaseUrl / store.Session
 */
import http from '@ohos.net.http';
import ohosRequest from '@ohos.request';
import common from '@ohos.app.ability.common';
import { Session } from '../store/Session';
import { ApiResponse } from '../models';

let baseUrl: string = '';

export function setBaseUrl(raw: string): void {
  // normalizeBaseUrl 在调用方（登录保存时）已处理；这里直接赋值规整结果
  baseUrl = raw;
}

export function getBaseUrl(): string {
  return baseUrl;
}

export class ApiError extends Error {
  code: number;
  constructor(message: string, code: number = -1) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
  }
}

interface RequestOptions {
  method?: http.RequestMethod;
  params?: Record<string, Object>;
  body?: Object;
  extraHeaders?: Record<string, string>;
  raw?: boolean;
}

async function buildHeaders(tokenOverride?: string): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  };
  const token = tokenOverride ?? (await Session.getAccessToken());
  if (token && token.length > 0) {
    headers['Authorization'] = 'Bearer ' + token;
  }
  const bookId = await Session.getCurrentBookId();
  if (bookId > 0) {
    headers['X-Book-Id'] = bookId.toString();
  }
  return headers;
}

async function tryRefresh(): Promise<string | null> {
  const rt = await Session.getRefreshToken();
  if (!rt) {
    return null;
  }
  const url = baseUrl + 'auth/refresh';
  const req = http.createHttp();
  try {
    const resp = await (req.request as unknown as (url: string, options?: http.HttpRequestOptions) => Promise<http.HttpResponse>)(url, {
      method: http.RequestMethod.POST,
      header: { 'Content-Type': 'application/json' },
      extraData: JSON.stringify({ refreshToken: rt }),
      connectTimeout: 10000,
      readTimeout: 10000
    });
    if (resp.responseCode === 200) {
      const str = typeof resp.result === 'string' ? resp.result : JSON.stringify(resp.result);
      const parsed = JSON.parse(str) as ApiResponse<{ token: string; refreshToken: string }>;
      if (parsed.success && parsed.data && parsed.data.token) {
        await Session.saveTokens(parsed.data.token, parsed.data.refreshToken);
        return parsed.data.token;
      }
    }
  } catch (e) {
    console.error('refresh failed: ' + JSON.stringify(e));
  } finally {
    req.destroy();
  }
  return null;
}

async function doRequest<T>(path: string, options: RequestOptions, tokenOverride?: string): Promise<ApiResponse<T>> {
  const method = options.method ?? http.RequestMethod.GET;
  let url = baseUrl + path;
  const headers = await buildHeaders(tokenOverride);
  if (options.extraHeaders) {
    Object.assign(headers, options.extraHeaders);
  }
  if (options.params) {
    const qs: string[] = [];
    for (const k in options.params) {
      const v = options.params[k];
      if (v !== undefined && v !== null && v !== '') {
        qs.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
      }
    }
    if (qs.length > 0) {
      url += (url.includes('?') ? '&' : '?') + qs.join('&');
    }
  }
  const req = http.createHttp();
  try {
    const resp = await (req.request as unknown as (url: string, options?: http.HttpRequestOptions) => Promise<http.HttpResponse>)(url, {
      method,
      header: headers,
      extraData: options.body ? JSON.stringify(options.body) : undefined,
      connectTimeout: 15000,
      readTimeout: 60000
    });
    if (options.raw) {
      const text = typeof resp.result === 'string' ? resp.result : '';
      return { success: resp.responseCode === 200, data: text as unknown as T, message: '' };
    }
    const resultStr = typeof resp.result === 'string' ? resp.result : JSON.stringify(resp.result);
    const parsed = JSON.parse(resultStr) as ApiResponse<T>;
    if (resp.responseCode === 401 && !tokenOverride) {
      const newToken = await tryRefresh();
      if (newToken) {
        return await doRequest<T>(path, options, newToken);
      }
      await Session.clear();
      throw new ApiError('登录已过期，请重新登录', 401);
    }
    if (!parsed.success) {
      throw new ApiError(parsed.message ?? '请求失败', resp.responseCode);
    }
    return parsed;
  } finally {
    req.destroy();
  }
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<ApiResponse<T>> {
  return doRequest<T>(path, options);
}

export async function get<T>(path: string, params?: Record<string, Object>, extraHeaders?: Record<string, string>): Promise<ApiResponse<T>> {
  return doRequest<T>(path, { method: http.RequestMethod.GET, params, extraHeaders });
}

export async function post<T>(path: string, body?: Object, params?: Record<string, Object>): Promise<ApiResponse<T>> {
  return doRequest<T>(path, { method: http.RequestMethod.POST, body, params });
}

export async function put<T>(path: string, body?: Object): Promise<ApiResponse<T>> {
  return doRequest<T>(path, { method: http.RequestMethod.PUT, body });
}

export async function del<T>(path: string): Promise<ApiResponse<T>> {
  return doRequest<T>(path, { method: http.RequestMethod.DELETE });
}

/** 暴露鉴权头（供文件下载/上传使用） */
export async function getAuthHeaders(): Promise<Record<string, string>> {
  return buildHeaders();
}

/**
 * 下载文件到本地（导出备份）：使用 @ohos.request 的 downloadFile，
 * 自动带鉴权头与 X-Book-Id。返回保存路径。
 */
export async function downloadFileTo(path: string, savePath: string): Promise<string> {
  const rawCtx = Session.getContext();
  if (!rawCtx) {
    throw new ApiError('未初始化上下文', -1);
  }
  const ctx = rawCtx as common.UIAbilityContext;
  const url = baseUrl + path;
  const headers = await buildHeaders();
  const downloadTask: ohosRequest.DownloadTask = await ohosRequest.downloadFile(ctx, {
    url,
    header: headers,
    filePath: savePath,
    enableMetered: true,
    enableRoaming: true
  });
  return new Promise<string>((resolve, reject) => {
    downloadTask.on('complete', () => resolve(savePath));
    downloadTask.on('fail', (err: number) => reject(new ApiError('下载失败（' + err + '）', err)));
  });
}

/**
 * 上传文件（导入备份）：使用 @ohos.request 的 uploadFile，multipart/form-data，
 * 字段名固定为 file（与服务端 multer.single('file') 对应）。返回解析后的 API 响应。
 */
export async function uploadFileFrom(path: string, filePath: string, fieldName: string = 'file'): Promise<ApiResponse<object>> {
  const rawCtx = Session.getContext();
  if (!rawCtx) {
    throw new ApiError('未初始化上下文', -1);
  }
  const ctx = rawCtx as common.UIAbilityContext;
  const url = baseUrl + path;
  const headers = await buildHeaders();
  const fileName = filePath.split('/').pop() || 'backup.xlsx';

  return new Promise<ApiResponse<object>>((resolve, reject) => {
    ohosRequest.uploadFile(ctx, {
      url,
      header: headers,
      method: 'POST',
      files: [{
        filename: fileName,
        name: fieldName,
        uri: filePath,
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      }],
      data: []
    }).then((uploadTask: ohosRequest.UploadTask) => {
      uploadTask.on('fail', (states: Array<ohosRequest.TaskState>) => {
        reject(new ApiError('上传失败', states[0]?.responseCode ?? -1));
      });
      uploadTask.on('complete', (states: Array<ohosRequest.TaskState>) => {
        const state = states[0];
        const code = state.responseCode;
        const resultStr = typeof state.message === 'string' ? state.message : '';
        let parsed: ApiResponse<object>;
        try {
          parsed = JSON.parse(resultStr) as ApiResponse<object>;
        } catch (e) {
          reject(new ApiError('服务器响应解析失败', code));
          return;
        }
        if (code === 401) {
          tryRefresh().then((newToken: string | null) => {
            if (newToken) {
              uploadFileFrom(path, filePath, fieldName).then(resolve, reject);
            } else {
              Session.clear();
              reject(new ApiError('登录已过期，请重新登录', 401));
            }
          });
          return;
        }
        if (!parsed.success) {
          reject(new ApiError(parsed.message ?? '导入失败', code));
          return;
        }
        resolve(parsed);
      });
    }).catch((e: Error) => {
      reject(new ApiError('上传发起失败：' + (e?.message ?? ''), -1));
    });
  });
}
