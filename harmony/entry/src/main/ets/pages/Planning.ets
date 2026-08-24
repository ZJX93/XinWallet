/**
 * 规划（对齐安卓 PlanningScreen.kt）：TabRow 4 Tab 聚合预算/储蓄/债务/理财。
 */
import { COLORS } from '../common/theme';
import { TopBar, AppBackground } from '../common/components/Components';
import { BudgetsPage } from './Budgets';
import { SavingsGoalsPage } from './SavingsGoals';
import { DebtsPage } from './Debts';
import { InvestmentsPage } from './Investments';

@Entry
@Component
struct Planning {
  @StorageProp('themeMode') themeMode: string = 'system';
  @State tab: number = 0;

  @Builder TabLabel(label: string, idx: number) {
    Column() {
      Text(label).fontSize(15).fontColor(this.tab === idx ? COLORS.brand : COLORS.textSecondary)
        .fontWeight(this.tab === idx ? FontWeight.Bold : FontWeight.Normal)
        .padding({ top: 12, bottom: 12 })
    }.width('100%').height(48).alignItems(HorizontalAlign.Center)
  }

  build() {
    Stack() {
      AppBackground()
      Column() {
        TopBar({ title: '规划' })
        Tabs({ barPosition: BarPosition.Start }) {
          TabContent() { BudgetsPage() }.tabBar(this.TabLabel('预算', 0))
          TabContent() { SavingsGoalsPage() }.tabBar(this.TabLabel('储蓄', 1))
          TabContent() { DebtsPage() }.tabBar(this.TabLabel('债务', 2))
          TabContent() { InvestmentsPage() }.tabBar(this.TabLabel('理财', 3))
        }.barBackgroundColor(COLORS.card)
          .onChange((idx: number) => this.tab = idx)
          .layoutWeight(1)
      }.width('100%').height('100%')
    }.width('100%').height('100%')
  }
}
