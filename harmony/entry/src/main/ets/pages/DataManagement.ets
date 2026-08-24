/**
 * 数据管理（账本备份）：导出/导入为 xlsx（3 工作表：账本配置页 / 账户页 / 账单流水页）。
 * 服务端生成与解析，App 仅调用接口；文件可被识别，用于数据损坏时恢复。
 */
import common from '@ohos.app.ability.common';
import fs from '@ohos.file.fs';
import fileUri from '@ohos.file.fileuri';
import picker from '@ohos.file.picker';
import type Want from '@ohos.app.ability.Want';
import * as Api from '../common/api/Api';
import { ApiError } from '../common/http/Http';
import { COLORS } from '../common/theme';
import { TopBar, LoadingBox, AppBackground } from '../common/components/Components';

@Entry
@Component
struct DataManagement {
  @StorageProp('themeMode') themeMode: string = 'system';
  @State loading: boolean = false;
  @State msg: string = '';
  private ctx: common.UIAbilityContext = getContext(this) as common.UIAbilityContext;

  /** 导出账本备份：服务端生成 xlsx，下载到本地并弹出分享/保存 */
  async doExportBackup(): Promise<void> {
    if (this.loading) return;
    this.loading = true; this.msg = '正在导出备份…';
    try {
      const path = await Api.exportBackup();
      this.msg = `已生成备份：${path}`;
      // 尝试调用系统分享面板保存到本地（无可用目标时回退到展示路径）
      try {
        const uri = fileUri.getUriFromPath(path);
        const want: Want = {
          action: 'ohos.want.action.send',
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          parameters: { uri }
        };
        await this.ctx.startAbility(want);
      } catch (e) {
        // 分享面板不可用不影响已完成的导出
        console.info('share skipped: ' + JSON.stringify(e));
      }
    } catch (e) {
      this.msg = '导出失败：' + (e as ApiError).message;
    } finally {
      this.loading = false;
    }
  }

  /** 导入账本备份：选择 xlsx 文件，上传到服务端解析恢复 */
  async doImportBackup(): Promise<void> {
    if (this.loading) return;
    this.loading = true; this.msg = '请选择备份文件…';
    try {
      const dp = new picker.DocumentViewPicker();
      const uris = await dp.select({ maxSelectNumber: 1, fileSuffixFilters: ['.xlsx'] });
      if (!uris || uris.length === 0) {
        this.msg = '未选择文件';
        return;
      }
      const srcUri = uris[0];
      // 复制到缓存目录（picker 返回的 uri 可能不可被网络上传直接读取）
      const tmp = `${this.ctx.cacheDir}/import_${Date.now()}.xlsx`;
      fs.copyFileSync(srcUri, tmp);
      const r = await Api.importBackup(tmp);
      const imp = (r.data as object) ? (r.data as Record<string, Object>)['imported'] : undefined;
      if (r.success) {
        let summary = '';
        if (imp) {
          const entries = Object.entries(imp as Record<string, number>);
          for (let i = 0; i < entries.length; i++) {
            const k = entries[i][0];
            const v = entries[i][1];
            if ((v as number) > 0) {
              summary += (summary ? '  ' : '') + `${k}:${v}`;
            }
          }
        }
        this.msg = '账本已恢复 ✅' + (summary ? '\n' + summary : '');
      } else {
        this.msg = '恢复失败：' + (r.message || '未知错误');
      }
    } catch (e) {
      this.msg = '导入失败：' + (e as ApiError).message;
    } finally {
      this.loading = false;
    }
  }

  @Builder ActionCard(title: string, desc: string, btn: string, onClick: () => void) {
    Column({ space: 8 }) {
      Text(title).fontSize(16).fontWeight(FontWeight.Medium).fontColor(COLORS.textPrimary)
      Text(desc).fontSize(13).fontColor(COLORS.textSecondary)
      Button(btn).width('100%').onClick(onClick)
    }.width('100%').padding(16).backgroundColor(COLORS.cardGlass).borderRadius(14)
    .border({ width: 0.5, color: COLORS.outlineVariant })
  }

  build() {
    Stack() {
      AppBackground()
      Column() {
        TopBar({ title: '数据管理' })
        if (this.loading) { LoadingBox() }
        Scroll() {
          Column({ space: 12 }) {
            this.ActionCard(
              '导出账本备份',
              '导出 xlsx（账本配置页 / 账户页 / 账单流水页），可识别、可恢复',
              '导出备份',
              () => this.doExportBackup()
            )
            this.ActionCard(
              '导入账本备份',
              '选择此前导出的 xlsx，恢复全部账本数据（损坏时可还原）',
              '导入备份',
              () => this.doImportBackup()
            )
            if (this.msg) {
              Text(this.msg)
                .fontSize(13)
                .fontColor(COLORS.textSecondary)
                .padding(12)
            }
            Blank().height(20)
          }.padding(12)
        }.layoutWeight(1)
      }.width('100%').height('100%')
    }.width('100%').height('100%')
  }
}
