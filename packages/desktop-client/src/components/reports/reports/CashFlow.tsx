import React, { useState, useEffect, useMemo } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';

import { AlignedText } from '@actual-app/components/aligned-text';
import { Block } from '@actual-app/components/block';
import { Button } from '@actual-app/components/button';
import { Paragraph } from '@actual-app/components/paragraph';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import * as d from 'date-fns';

import { addNotification } from 'loot-core/client/actions';
import { useWidget } from 'loot-core/client/data-hooks/widget';
import { send } from 'loot-core/platform/client/fetch';
import * as monthUtils from 'loot-core/shared/months';
import { integerToCurrency } from 'loot-core/shared/util';
import {
  type CashFlowWidget,
  type RuleConditionEntity,
  type TimeFrame,
} from 'loot-core/types/models';

import { useFeatureFlag } from '../../../hooks/useFeatureFlag';
import { useFilters } from '../../../hooks/useFilters';
import { useNavigate } from '../../../hooks/useNavigate';
import { useSyncedPref } from '../../../hooks/useSyncedPref';
import { useDispatch } from '../../../redux';
import { EditablePageHeaderTitle } from '../../EditablePageHeaderTitle';
import { MobileBackButton } from '../../mobile/MobileBackButton';
import { MobilePageHeader, Page, PageHeader } from '../../Page';
import { PrivacyFilter } from '../../PrivacyFilter';
import { useResponsive } from '../../responsive/ResponsiveProvider';
import { Change } from '../Change';
import { ForecastHeader } from '../ForecastHeader';
import { CashFlowGraph } from '../graphs/CashFlowGraph';
import { Header } from '../Header';
import { LoadingIndicator } from '../LoadingIndicator';
import { calculateTimeRange } from '../reportRanges';
import { cashFlowByDate } from '../spreadsheets/cash-flow-spreadsheet';
import { useReport } from '../useReport';

export const defaultTimeFrame = {
  start: monthUtils.dayFromDate(monthUtils.currentMonth()),
  end: monthUtils.currentDay(),
  mode: 'sliding-window',
} satisfies TimeFrame;

export function CashFlow() {
  const params = useParams();
  const { data: widget, isLoading } = useWidget<CashFlowWidget>(
    params.id ?? '',
    'cash-flow-card',
  );

  if (isLoading) {
    return <LoadingIndicator />;
  }

  return <CashFlowInner widget={widget} />;
}

type CashFlowInnerProps = {
  widget?: CashFlowWidget;
};

function CashFlowInner({ widget }: CashFlowInnerProps) {
  const dispatch = useDispatch();
  const { t } = useTranslation();

  const {
    conditions,
    conditionsOp,
    onApply: onApplyFilter,
    onDelete: onDeleteFilter,
    onUpdate: onUpdateFilter,
    onConditionsOpChange,
  } = useFilters<RuleConditionEntity>(
    widget?.meta?.conditions,
    widget?.meta?.conditionsOp,
  );

  const [allMonths, setAllMonths] = useState<null | Array<{
    name: string;
    pretty: string;
  }>>(null);

  const [totalMonths, setTotalMonths] = useState(12);

  const [allForecastMonths, setAllForecastMonths] = useState<null | Array<{
    name: string;
    pretty: string;
  }>>(null);

  const [initialStart, initialEnd, initialMode] = calculateTimeRange(
    widget?.meta?.timeFrame,
    defaultTimeFrame,
  );
  const [start, setStart] = useState(initialStart);
  const [end, setEnd] = useState(initialEnd);
  const [mode, setMode] = useState(initialMode);
  const [showBalance, setShowBalance] = useState(
    widget?.meta?.showBalance ?? true,
  );

  const [isConcise, setIsConcise] = useState(() => {
    const numDays = d.differenceInCalendarDays(
      d.parseISO(end),
      d.parseISO(start),
    );
    return numDays > 31 * 3;
  });

  const forecastFeatureFlag = useFeatureFlag('cashflowForecast');

  const allForecastSource = [
    { name: 'none', pretty: t('None') },
    { name: 'schedule', pretty: t('Schedule') },
    { name: 'transactions', pretty: t('Transactions') },
    { name: 'budget', pretty: t('Budget') },
  ];

  const allForecastMethods = [
    { name: 'lastMonths', pretty: t('Average') },
    { name: 'perMonth', pretty: t('Per-month Average') },
    { name: 'minAvgMax', pretty: t('Min/Max/Average') },
    { name: 'monteCarlo', pretty: t('Monte Carlo') },
  ];

  const [forecastSource, setForecastSource] = useState('none');
  const [forecastSourceStart, setForecastSourceStart] = useState(initialStart);
  const [forecastSourceEnd, setForecastSourceEnd] = useState(initialEnd);
  const [forecastMethod, setForecastMethod] = useState('lastMonths');

  const [averageMonths, setAverageMonths] = useState(2);
  const [averageYears, setAverageYears] = useState(2);

  const params = useMemo(
    () =>
      cashFlowByDate(
        start,
        end,
        isConcise,
        conditions,
        conditionsOp,
        forecastSource,
        forecastMethod,
        forecastSourceStart,
        forecastSourceEnd,
      ),
    [
      start,
      end,
      isConcise,
      conditions,
      conditionsOp,
      forecastSource,
      forecastMethod,
      forecastSourceStart,
      forecastSourceEnd,
    ],
  );
  const data = useReport('cash_flow', params);

  useEffect(() => {
    async function run() {
      const trans = await send('get-earliest-transaction');
      const earliestMonth = trans
        ? monthUtils.monthFromDate(d.parseISO(trans.date))
        : monthUtils.currentMonth();

      const totalMonths = monthUtils.differenceInCalendarMonths(
        monthUtils.currentMonth(),
        earliestMonth,
      );

      const allMonths = monthUtils
        .rangeInclusive(earliestMonth, monthUtils.currentMonth())
        .map(month => ({
          name: month,
          pretty: monthUtils.format(month, 'MMMM, yyyy'),
        }))
        .reverse();

      const allForecastMonths = monthUtils
        .rangeInclusive(
          earliestMonth,
          monthUtils.addYears(monthUtils.currentMonth(), 10),
        )
        .map(month => ({
          name: month,
          pretty: monthUtils.format(month, 'MMMM, yyyy'),
        }))
        .reverse();

      setTotalMonths(totalMonths);
      setAllMonths(allMonths);
      setAllForecastMonths(allForecastMonths);
    }
    run();
  }, []);

  function onChangeDates(start: string, end: string, mode: TimeFrame['mode']) {
    const numDays = d.differenceInCalendarDays(
      d.parseISO(end),
      d.parseISO(start),
    );
    const isConcise = numDays > 31 * 3;

    setStart(start);
    setEnd(end);
    setMode(mode);
    setIsConcise(isConcise);
  }

  // FIME: recalculate forecast on any forecast change
  function onChangeForecast(
    dataStart: string,
    dataEnd: string,
    method: string,
    source: string,
  ) {
    setForecastSourceStart(dataStart);
    setForecastSourceEnd(dataEnd);
    setForecastMethod(method);
    setForecastSource(source);
  }

  const navigate = useNavigate();
  const { isNarrowWidth } = useResponsive();

  async function onSaveWidget() {
    if (!widget) {
      throw new Error('No widget that could be saved.');
    }

    await send('dashboard-update-widget', {
      id: widget.id,
      meta: {
        ...(widget.meta ?? {}),
        conditions,
        conditionsOp,
        timeFrame: {
          start,
          end,
          mode,
        },
        showBalance,
      },
    });
    dispatch(
      addNotification({
        type: 'message',
        message: t('Dashboard widget successfully saved.'),
      }),
    );
  }

  const title = widget?.meta?.name || t('Cash Flow');
  const onSaveWidgetName = async (newName: string) => {
    if (!widget) {
      throw new Error('No widget that could be saved.');
    }

    const name = newName || t('Cash Flow');
    await send('dashboard-update-widget', {
      id: widget.id,
      meta: {
        ...(widget.meta ?? {}),
        name,
      },
    });
  };

  const [earliestTransaction, _] = useState('');
  const [_firstDayOfWeekIdx] = useSyncedPref('firstDayOfWeekIdx');
  const firstDayOfWeekIdx = _firstDayOfWeekIdx || '0';

  if (!allMonths || !data) {
    return null;
  }

  const { graphData, totalExpenses, totalIncome, totalTransfers } = data;

  return (
    <Page
      header={
        isNarrowWidth ? (
          <MobilePageHeader
            title={title}
            leftContent={
              <MobileBackButton onPress={() => navigate('/reports')} />
            }
          />
        ) : (
          <PageHeader
            title={
              widget ? (
                <EditablePageHeaderTitle
                  title={title}
                  onSave={onSaveWidgetName}
                />
              ) : (
                title
              )
            }
          />
        )
      }
      padding={0}
    >
      <Header
        allMonths={forecastSource !== 'none' ? allForecastMonths : allMonths}
        start={start}
        end={end}
        earliestTransaction={earliestTransaction}
        firstDayOfWeekIdx={firstDayOfWeekIdx}
        mode={mode}
        show1Month
        onChangeDates={onChangeDates}
        onApply={onApplyFilter}
        filters={conditions}
        onUpdateFilter={onUpdateFilter}
        onDeleteFilter={onDeleteFilter}
        conditionsOp={conditionsOp}
        onConditionsOpChange={onConditionsOpChange}
      >
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Button onPress={() => setShowBalance(state => !state)}>
            {showBalance ? t('Hide balance') : t('Show balance')}
          </Button>

          {widget && (
            <Button variant="primary" onPress={onSaveWidget}>
              <Trans>Save widget</Trans>
            </Button>
          )}
        </View>
      </Header>
      {forecastFeatureFlag && (
        <ForecastHeader
          allForecastSource={allForecastSource}
          allMonths={allMonths}
          allForecastMethods={allForecastMethods}
          forecastSource={forecastSource}
          forecastSourceStart={forecastSourceStart}
          forecastSourceEnd={forecastSourceEnd}
          forecastMethod={forecastMethod}
          averageMonths={averageMonths}
          averageYears={averageYears}
          setForecastSource={setForecastSource}
          setForecastSourceStart={setForecastSourceStart}
          setForecastSourceEnd={setForecastSourceEnd}
          setForecastMethod={setForecastMethod}
          setAverageMonths={setAverageMonths}
          setAverageYears={setAverageYears}
          maxMonths={totalMonths}
          // onChangeForecast={onChangeForecast}
        />
      )}
      <View
        style={{
          backgroundColor: theme.tableBackground,
          padding: 20,
          paddingTop: 0,
          flex: '1 0 auto',
          overflowY: 'auto',
        }}
      >
        <View
          style={{
            paddingTop: 20,
            alignItems: 'flex-end',
            color: theme.pageText,
          }}
        >
          <AlignedText
            style={{ marginBottom: 5, minWidth: 160 }}
            left={
              <Block>
                <Trans>Income:</Trans>
              </Block>
            }
            right={
              <Text style={{ fontWeight: 600 }}>
                <PrivacyFilter>{integerToCurrency(totalIncome)}</PrivacyFilter>
              </Text>
            }
          />

          <AlignedText
            style={{ marginBottom: 5, minWidth: 160 }}
            left={
              <Block>
                <Trans>Expenses:</Trans>
              </Block>
            }
            right={
              <Text style={{ fontWeight: 600 }}>
                <PrivacyFilter>
                  {integerToCurrency(totalExpenses)}
                </PrivacyFilter>
              </Text>
            }
          />

          <AlignedText
            style={{ marginBottom: 5, minWidth: 160 }}
            left={
              <Block>
                <Trans>Transfers:</Trans>
              </Block>
            }
            right={
              <Text style={{ fontWeight: 600 }}>
                <PrivacyFilter>
                  {integerToCurrency(totalTransfers)}
                </PrivacyFilter>
              </Text>
            }
          />
          <Text style={{ fontWeight: 600 }}>
            <PrivacyFilter>
              <Change amount={totalIncome + totalExpenses + totalTransfers} />
            </PrivacyFilter>
          </Text>
        </View>

        <CashFlowGraph
          graphData={graphData}
          isConcise={isConcise}
          showBalance={showBalance}
        />

        <View
          style={{
            marginTop: 30,
            userSelect: 'none',
          }}
        >
          <Trans>
            <Paragraph>
              <strong>How is cash flow calculated?</strong>
            </Paragraph>
            <Paragraph>
              Cash flow shows the balance of your budgeted accounts over time,
              and the amount of expenses/income each day or month. Your budgeted
              accounts are considered to be “cash on hand,” so this gives you a
              picture of how available money fluctuates.
            </Paragraph>
          </Trans>
          {forecastFeatureFlag && (
            <Trans>
              <Paragraph>
                <strong>Forecasting</strong>
              </Paragraph>
              <Paragraph>
                Forecasts are based on one of three sources:
                <ul>
                  <li>
                    <strong>Schedule</strong> uses your scheduled transactions.
                  </li>
                  <li>
                    <strong>Transactions</strong> and <strong>Budget</strong>{' '}
                    use your past transactions or budget. These can be used to
                    predict future cash flow using different models:
                    <ul>
                      <li>Average: The average of the last N months.</li>
                      <li>
                        Per-month Average: The average of each month the last N
                        years. The forecast for each June, for example, is based
                        on the average of all Junes.
                      </li>
                      <li>
                        Min/Max/Average: This generates a range of scenarios,
                        based on the minimum, maximum, and average of a range of
                        months.
                      </li>
                      <li>
                        Monte Carlo: this generates a range of scenarios based
                        on the distribution of past months.
                      </li>
                    </ul>
                  </li>
                </ul>
              </Paragraph>
            </Trans>
          )}
        </View>
      </View>
    </Page>
  );
}
