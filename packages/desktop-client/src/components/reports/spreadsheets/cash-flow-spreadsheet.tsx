import React from 'react';

import { AlignedText } from '@actual-app/components/aligned-text';
import * as d from 'date-fns';
import { t } from 'i18next';

import { runQuery } from 'loot-core/client/query-helpers';
import { type useSpreadsheet } from 'loot-core/client/SpreadsheetProvider';
import { send, sendCatch } from 'loot-core/platform/client/fetch';
import * as monthUtils from 'loot-core/shared/months';
import { q } from 'loot-core/shared/query';
import { integerToCurrency, integerToAmount } from 'loot-core/shared/util';
import { type RuleConditionEntity } from 'loot-core/types/models';

import { runAll, indexCashFlow } from '../util';

export function simpleCashFlow(
  startMonth: string,
  endMonth: string,
  conditions: RuleConditionEntity[] = [],
  conditionsOp: 'and' | 'or' = 'and',
) {
  const start = monthUtils.firstDayOfMonth(startMonth);
  const end = monthUtils.lastDayOfMonth(endMonth);

  return async (
    spreadsheet: ReturnType<typeof useSpreadsheet>,
    setData: (data: { graphData: { income: number; expense: number } }) => void,
  ) => {
    const { filters } = await send('make-filters-from-conditions', {
      conditions: conditions.filter(cond => !cond.customName),
    });
    const conditionsOpKey = conditionsOp === 'or' ? '$or' : '$and';

    function makeQuery() {
      return q('transactions')
        .filter({
          [conditionsOpKey]: filters,
          $and: [
            { date: { $gte: start } },
            {
              date: {
                $lte:
                  end > monthUtils.currentDay() ? monthUtils.currentDay() : end,
              },
            },
          ],
          'account.offbudget': false,
          'payee.transfer_acct': null,
        })
        .calculate({ $sum: '$amount' });
    }

    return runAll(
      [
        makeQuery().filter({ amount: { $gt: 0 } }),
        makeQuery().filter({ amount: { $lt: 0 } }),
      ],
      data => {
        setData({
          graphData: {
            income: data[0],
            expense: data[1],
          },
        });
      },
    );
  };
}

export function cashFlowByDate(
  startMonth: string,
  endMonth: string,
  isConcise: boolean,
  conditions: RuleConditionEntity[] = [],
  conditionsOp: 'and' | 'or',
  forecastSource: string,
  forecastMethod: string,
  forecastSourceStartMonth: string,
  forecastSourceEndMonth: string,
) {
  const newEndMonth = forecastSource === 'none' ? endMonth : '2035-02';

  const start = monthUtils.firstDayOfMonth(startMonth);
  // if endMonth is in the future, set end to current month, and set forecastEnd to endMonth,
  // otherwise set end to endMonth, and forecastEnd to null
  const end =
    newEndMonth > monthUtils.currentDay()
      ? monthUtils.lastDayOfMonth(monthUtils.currentDay())
      : monthUtils.lastDayOfMonth(newEndMonth);
  const forecastEnd =
    newEndMonth > monthUtils.currentDay() ? newEndMonth : null;
  const fixedEnd =
    end > monthUtils.currentDay() ? monthUtils.currentDay() : end;

  const forecastSourceStart = monthUtils.firstDayOfMonth(
    forecastSourceStartMonth,
  );
  const forecastSourceEnd = monthUtils.firstDayOfMonth(forecastSourceEndMonth);

  // const needsMethod = forecastSource === 'transaction' || forecastSource === 'budget';

  return async (
    spreadsheet: ReturnType<typeof useSpreadsheet>,
    setData: (data: ReturnType<typeof recalculate>) => void,
  ) => {
    const { filters } = await send('make-filters-from-conditions', {
      conditions: conditions.filter(cond => !cond.customName),
    });
    const conditionsOpKey = conditionsOp === 'or' ? '$or' : '$and';

    function makeQuery(qStatrt: string, qEnd: string) {
      const query = q('transactions')
        .filter({
          [conditionsOpKey]: filters,
        })
        .filter({
          $and: [
            { date: { $transform: '$month', $gte: qStatrt } },
            { date: { $transform: '$month', $lte: qEnd } },
          ],
          'account.offbudget': false,
        });

      if (isConcise) {
        return query
          .groupBy([{ $month: '$date' }, 'payee.transfer_acct'])
          .select([
            { date: { $month: '$date' } },
            { isTransfer: 'payee.transfer_acct' },
            { amount: { $sum: '$amount' } },
          ]);
      }

      return query
        .groupBy(['date', 'payee.transfer_acct'])
        .select([
          'date',
          { isTransfer: 'payee.transfer_acct' },
          { amount: { $sum: '$amount' } },
        ]);
    }

    let forecastTransactionData = null;
    let forecastBudgetData = null;
    let forecastScheduleData = null;

    const forecastData: [forecastIncome: any, forecastExpense: any] = [
      null,
      null,
    ];

    // for each forecastSource, make a query to get the data
    if (forecastSource === 'transactions') {
      // forecastData.push([
      forecastTransactionData = await Promise.all([
        runQuery(
          makeQuery(forecastSourceStart, forecastSourceEnd)
            .filter({ amount: { $gt: 0 } })
            .filter({ 'category.name': { $notlike: 'Starting Balances' } }),
        ).then(({ data }) => data),
        runQuery(
          makeQuery(forecastSourceStart, forecastSourceEnd)
            .filter({ amount: { $lt: 0 } })
            .filter({ 'category.name': { $notlike: 'Starting Balances' } }),
        ).then(({ data }) => data),
      ]);
      // ]);
    }

    if (forecastSource === 'budget') {
      const { filters: budgetFilters } = await send(
        'make-filters-from-conditions',
        {
          conditions: conditions.filter(
            cond => !cond.customName && cond.field === 'category',
          ),
          applySpecialCases: false,
        },
      );

      // forecastData.push([
      forecastBudgetData = await Promise.all([
        runQuery(
          q('zero_budgets')
            .filter({
              $and: [
                { month: { $gte: forecastSourceStart } },
                { month: { $lte: forecastSourceEnd } },
              ],
            })
            .filter({
              [conditionsOpKey]: budgetFilters,
            })
            .groupBy([{ $id: '$category' }])
            .select([
              { category: { $id: '$category' } },
              { amount: { $sum: '$amount' } },
            ]),
        ).then(({ data }) => data),
      ]);
      //   null,
      // ]);
    }

    if (forecastSource === 'schedule') {
      forecastMethod = 'schedule';

      let scheduleQuery = q('schedules').select([
        '*',
        { isTransfer: '_payee.transfer_acct' },
        { isAccountOffBudget: '_account.offbudget' },
        { isPayeeOffBudget: '_payee.transfer_acct.offbudget' },
      ]);
      type ScheduleFilter = {
        account: string;
        payee: string;
        amount: string;
      };
      const scheduleFilters = filters.flatMap((filter: ScheduleFilter) => {
        if (filter.hasOwnProperty('account')) {
          const { account } = filter;
          return [{ _account: account }, { '_payee.transfer_acct': account }];
        }
        if (filter.hasOwnProperty('payee')) {
          const { payee } = filter;
          return { _payee: payee };
        }
        return [];
      });
      if (scheduleFilters.length > 0) {
        scheduleQuery = scheduleQuery.filter({
          $or: [...scheduleFilters],
        });
      }
      const { data: scheduledata } = await runQuery(scheduleQuery);

      // // forecastData.push([
      // forecastScheduleData = await Promise.all(
      //   scheduledata.map(schedule => {
      //     if (typeof schedule._date !== 'string') {
      //       return sendCatch('schedule/get-occurrences-to-date', {
      //         config: schedule._date,
      //         end: forecastEnd,
      //       }).then(({ data }) => {
      //         schedule._dates = data;
      //         return schedule;
      //       });
      //     } else {
      //       schedule._dates = [schedule._date];
      //       return schedule;
      //     }
      //   }),
      // );
      // //   null,
      // //   null,
      // // ]);
    }

    return runAll(
      [
        q('transactions')
          .filter({
            [conditionsOpKey]: filters,
            date: { $transform: '$month', $lt: start },
            'account.offbudget': false,
          })
          .calculate({ $sum: '$amount' }),
        makeQuery(start, fixedEnd).filter({ amount: { $gt: 0 } }),
        makeQuery(start, fixedEnd).filter({ amount: { $lt: 0 } }),
      ],
      data => {
        setData(
          recalculate(
            data,
            start,
            fixedEnd,
            isConcise,
            filters,
            forecastEnd,
            fixedEnd,
            forecastTransactionData,
            forecastBudgetData,
            forecastScheduleData,
            forecastMethod,
          ),
        );
      },
    );
  };
}

function recalculate(
  data: [
    number,
    Array<{ date: string; isTransfer: string | null; amount: number }>,
    Array<{ date: string; isTransfer: string | null; amount: number }>,
  ],
  start: string,
  end: string,
  isConcise: boolean,
  filters: any[],
  forecastEnd: string,
  fixedEnd: string,
  forecastTransactionData,
  forecastBudgetData,
  forecastScheduleData,
  forecastMethod: string,
) {
  const [startingBalance, income, expense] = data;
  const convIncome = income.map(trans => {
    return { ...trans, isTransfer: trans.isTransfer !== null };
  });
  const convExpense = expense.map(trans => {
    return { ...trans, isTransfer: trans.isTransfer !== null };
  });
  const dates = isConcise
    ? monthUtils.rangeInclusive(
        monthUtils.getMonth(start),
        monthUtils.getMonth(end),
      )
    : monthUtils.dayRangeInclusive(start, end);
  const incomes = indexCashFlow(convIncome);
  const expenses = indexCashFlow(convExpense);

  let balance = startingBalance;
  let totalExpenses = 0;
  let totalIncome = 0;
  let totalTransfers = 0;

  const forecastDates = monthUtils.rangeInclusive(
    monthUtils.getMonth(fixedEnd),
    monthUtils.getMonth(forecastEnd),
  );
  let futureExpense = [];
  let futureIncome = [];

  // const forecastDataAvailable =
  //   forecastData[0] !== null || forecastData[1] !== null;

  const forecastData = forecastTransactionData || forecastBudgetData;

  // add switch cases for forecastSource and forecastMethod to calcualte future graphData
  // Calculates forecast based on the average transactions/budget in the selected period.
  if (forecastScheduleData && forecastMethod === 'schedule') {
    const [schedules] = forecastScheduleData;
    schedules.forEach(schedule => {
      schedule._dates?.forEach(date => {
        const futureTx = {
          date: isConcise ? monthUtils.monthFromDate(date) : date,
          isTransfer: schedule.isTransfer != null,
          trasferAccount: schedule.isTransfer,
          amount:
            schedule._amountOp === 'isbetween'
              ? (schedule._amount.num1 + schedule._amount.num2) / 2
              : schedule._amount,
        };

        const includeFutureTx =
          filters.reduce((include, filter) => {
            return (
              include ||
              (filter.hasOwnProperty('account')
                ? filter.account.$eq === schedule._account
                : true)
            );
          }, filters.length === 0) && !schedule.isAccountOffBudget;

        const includeTransfer = filters.reduce((include, filter) => {
          return (
            include ||
            (filter.hasOwnProperty('account')
              ? filter.account.$eq === futureTx.trasferAccount
              : true)
          );
        }, filters.length === 0);

        if (
          futureTx.isTransfer &&
          !schedule.isPayeeOffBudget &&
          includeTransfer
        ) {
          const futureTxTransfer = {
            date: isConcise ? monthUtils.monthFromDate(date) : date,
            isTransfer: schedule.isTransfer != null,
            amount: -schedule._amount,
          };
          if (futureTxTransfer.amount < 0) {
            futureExpense.push(futureTxTransfer);
          } else {
            futureIncome.push(futureTxTransfer);
          }
        }

        if (includeFutureTx) {
          if (futureTx.amount < 0) {
            futureExpense.push(futureTx);
          } else {
            futureIncome.push(futureTx);
          }
        }
      });
    });
  }

  if (forecastData && forecastMethod === 'lastMonths') {
    // Calculate averages
    const averageExpense =
      forecastData[1].reduce((acc, trans) => acc + trans.amount, 0) /
      forecastData[1].length;
    const averageIncome =
      forecastData[0].reduce((acc, trans) => acc + trans.amount, 0) /
      forecastData[0].length;

    // Calculate future graphData
    // for each month in the forecast period, add the average income and expense
    forecastDates.forEach(date => {
      futureIncome.push({
        date: isConcise ? monthUtils.monthFromDate(date) : date,
        isTransfer: false,
        amount: averageIncome,
      });
      futureExpense.push({
        date: isConcise ? monthUtils.monthFromDate(date) : date,
        isTransfer: false,
        amount: averageExpense,
      });
    });
  }

  // Calculates forecast based on the per-month average transactions/budget in the selected period.
  if (forecastData && forecastMethod === 'perMonth') {
    futureExpense.push({ date: '2025-03', isTransfer: false, amount: 3000 });
    futureExpense.push({ date: '2025-04', isTransfer: false, amount: 2000 });
    futureExpense.push({ date: '2025-05', isTransfer: false, amount: 1000 });
    // Calculate averages
    // Calculate future graphData
  }

  if (forecastData && forecastMethod === 'minAvgMax') {
    futureExpense.push({ date: '2025-03', isTransfer: false, amount: 3000 });
    futureExpense.push({ date: '2025-04', isTransfer: false, amount: 2000 });
    futureExpense.push({ date: '2025-05', isTransfer: false, amount: 1000 });
    // Calculate averages
    // Calculate future graphData
  }

  if (forecastData && forecastMethod === 'monteCarlo') {
    futureExpense.push({ date: '2025-03', isTransfer: false, amount: 3000 });
    futureExpense.push({ date: '2025-04', isTransfer: false, amount: 2000 });
    futureExpense.push({ date: '2025-05', isTransfer: false, amount: 1000 });
  }

  // const futureGraphData = forecastDates.reduce<{
  //   futureExpenses: Array<{ x: Date; y: number }>;
  //   futureIncome: Array<{ x: Date; y: number }>;
  //   futureBalances: Array<{ x: Date; y: number }>;
  // }>(
  //   (res, date) => {
  //     let income = 0;
  //     let expense = 0;

  //     if (futureIncome[date]) {
  //       income = !futureIncome[date].false ? 0 : futureIncome[date].false;
  //     }
  //     if (futureExpense[date]) {
  //       expense = !futureExpense[date].false ? 0 : futureExpense[date].false;
  //     }

  //     balance += income + expense;
  //     const x = d.parseISO(date);

  //     res.futureIncome.push({ x, y: integerToAmount(income) });
  //     res.futureExpenses.push({ x, y: integerToAmount(expense) });
  //     res.futureBalances.push({ x, y: integerToAmount(balance) });

  //     return res;
  //   },
  //   { futureExpenses: [], futureIncome: [], futureBalances: [] },
  // );

  const graphData = dates.reduce<{
    expenses: Array<{ x: Date; y: number }>;
    income: Array<{ x: Date; y: number }>;
    transfers: Array<{ x: Date; y: number }>;
    balances: Array<{
      x: Date;
      y: number;
      premadeLabel: JSX.Element;
      amount: number;
    }>;
  }>(
    (res, date) => {
      let income = 0;
      let expense = 0;
      let creditTransfers = 0;
      let debitTransfers = 0;

      if (incomes[date]) {
        income = !incomes[date].false ? 0 : incomes[date].false;
        creditTransfers = !incomes[date].true ? 0 : incomes[date].true;
      }
      if (expenses[date]) {
        expense = !expenses[date].false ? 0 : expenses[date].false;
        debitTransfers = !expenses[date].true ? 0 : expenses[date].true;
      }

      totalExpenses += expense;
      totalIncome += income;
      balance += income + expense + creditTransfers + debitTransfers;
      totalTransfers += creditTransfers + debitTransfers;
      const x = d.parseISO(date);

      const label = (
        <div>
          <div style={{ marginBottom: 10 }}>
            <strong>
              {d.format(x, isConcise ? 'MMMM yyyy' : 'MMMM d, yyyy')}
            </strong>
          </div>
          <div style={{ lineHeight: 1.5 }}>
            <AlignedText
              left={t('Income:')}
              right={integerToCurrency(income)}
            />
            <AlignedText
              left={t('Expenses:')}
              right={integerToCurrency(expense)}
            />
            <AlignedText
              left={t('Change:')}
              right={<strong>{integerToCurrency(income + expense)}</strong>}
            />
            {creditTransfers + debitTransfers !== 0 && (
              <AlignedText
                left={t('Transfers:')}
                right={integerToCurrency(creditTransfers + debitTransfers)}
              />
            )}
            <AlignedText
              left={t('Balance:')}
              right={integerToCurrency(balance)}
            />
          </div>
        </div>
      );

      res.income.push({ x, y: integerToAmount(income) });
      res.expenses.push({ x, y: integerToAmount(expense) });
      res.transfers.push({
        x,
        y: integerToAmount(creditTransfers + debitTransfers),
      });
      res.balances.push({
        x,
        y: integerToAmount(balance),
        premadeLabel: label,
        amount: balance,
      });
      return res;
    },
    { expenses: [], income: [], transfers: [], balances: [] },
  );

  const { balances } = graphData;

  return {
    graphData,
    // graphData: {
    //   ...graphData,
    //   futureExpenses: futureGraphData.futureExpenses,
    //   futureIncome: futureGraphData.futureIncome,
    //   futureBalances: futureGraphData.futureBalances,
    // },
    balance: balances[balances.length - 1].amount,
    totalExpenses,
    totalIncome,
    totalTransfers,
    totalChange: balances[balances.length - 1].amount - balances[0].amount,
  };
}
