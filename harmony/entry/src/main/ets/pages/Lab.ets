/**
 * 实验室（对齐安卓 AiToolsScreen.kt，v0.2.3 由「AI 工具」更名）：
 * 智能记账实验功能聚合页，收纳 5 个 AI 子模块入口，集中跳转。
 */
import router from '@ohos.router';
import { COLORS } from '../common/theme';
import { TopBar, AppBackground, RowItem } from '../common/components/Components';

@Entry
@Component
struct Lab {
  @StorageProp('themeMode') themeMode: string = 'system';

  build() {
    Stack() {
      AppBackground()
      Column() {
        TopBar({ title: '实验室' })
        Scroll() {
          Column({ space: 6 }) {
            // 顶部说明：与安卓 AiToolsScreen 顶部留白风格保持一致
            Text('智能记账 · 实验功能集中入口')
              .fontSize(13).fontColor(COLORS.textSecondary)
              .width('100%').padding({ left: 16, right: 16, top: 8, bottom: 4 })
            Column() {
              RowItem({ icon: '🧠', title: 'AI 建议', onItemClick: () => router.pushDestination({ url: 'pages/Advice' }) })
              RowItem({ icon: '☁️', title: 'AI 服务商', onItemClick: () => router.pushDestination({ url: 'pages/ProviderList' }) })
              RowItem({ icon: '📜', title: 'AI 规则', onItemClick: () => router.pushDestination({ url: 'pages/RuleList' }) })
              RowItem({ icon: '📊', title: '学习统计', onItemClick: () => router.pushDestination({ url: 'pages/LearningStats' }) })
              RowItem({ icon: '🧪', title: '模型评测', onItemClick: () => router.pushDestination({ url: 'pages/Evaluation' }) })
            }
            .width('100%')
            .borderRadius(16)
            .clip(true)
            .backgroundColor(COLORS.surface)
            .shadow({ radius: 2, color: '#0A000000', offsetY: 1 })
            Text('提示：所有数据保存在你自己的服务器，不上传给第三方。')
              .fontSize(11).fontColor(COLORS.textSecondary)
              .width('100%').padding({ left: 16, right: 16, top: 10 })
            Blank().height(20)
          }.padding({ left: 12, right: 12, top: 4 })
        }.layoutWeight(1)
      }.width('100%').height('100%')
    }.width('100%').height('100%')
  }
}
