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
  const start = monthUtils.firstDayOfMonth(startMonth);
  // if endMonth is in the future, set end to current month, and set forecastEnd to endMonth,
  // otherwise set end to endMonth, and forecastEnd to null
  const end = endMonth > monthUtils.currentDay() ? monthUtils.lastDayOfMonth(monthUtils.currentDay()) : monthUtils.lastDayOfMonth(endMonth);
  const forecastEnd = endMonth > monthUtils.currentDay() ? endMonth : null;
  const fixedEnd =
    end > monthUtils.currentDay() ? monthUtils.currentDay() : end;

  const forecastSourceStart = monthUtils.firstDayOfMonth(forecastSourceStartMonth);
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

    const queries = [];

    function makeQuery(qTable: string, qStatrt: string, qEnd: string) {
      const query = q(qTable)
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

    queries.push(
      q('transactions')
        .filter({
          [conditionsOpKey]: filters,
          date: { $transform: '$month', $lt: start },
          'account.offbudget': false,
        })
        .calculate({ $sum: '$amount' }),    // sarting balance
      makeQuery('transactions', start, fixedEnd).filter({ amount: { $gt: 0 } }), // income
      makeQuery('transactions', start, fixedEnd).filter({ amount: { $lt: 0 } }), // expense
    );

    // for each forecastSource, make a query to get the data
    if (forecastSource === 'transaction' || forecastSource === 'budget') {
      queries.push(
        makeQuery(forecastSource, forecastSourceStart, forecastSourceEnd).filter({ amount: { $gt: 0 } })
          .filter({ 'category.name': { $notlike: 'Starting Balances' } }),
        makeQuery(forecastSource, forecastSourceStart, forecastSourceEnd).filter({ amount: { $lt: 0 } })
          .filter({ 'category.name': { $notlike: 'Starting Balances' } }),
      );
    }

    if (forecastSource === 'schedule') {
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
      
      let schedules = [];
      
      schedules = await Promise.all(
        scheduledata.map(schedule => {
          if (typeof schedule._date !== 'string') {
            return sendCatch('schedule/get-occurrences-to-date', {
              config: schedule._date,
              end: forecastEnd,
            }).then(({ data }) => {
              schedule._dates = data;
              return schedule;
            });
          } else {
            schedule._dates = [schedule._date];
            return schedule;
          }
        }),
      );
    }

    return runAll(queries, data => {
        setData(recalculate(data, start, fixedEnd, isConcise));
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
  // extend with forecast data
  start: string,
  end: string,
  isConcise: boolean,
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

  // add switch cases for forecastSource and forecastMethod to calcualte future graphData
  // Calculates forecast based on the average transactions/budget in the selected period.
  if (forecastDataAvailable && forecastMethod === 'lastMonths') {
  }
  
  // Calculates forecast based on the per-month average transactions/budget in the selected period.
  if (forecastDataAvailable && forecastMethod === 'perMonth') {
    }


    if (forecastDataAvailable && forecastMethod === 'minAvgMax') {
    }


    if (forecastDataAvailable && forecastMethod === 'monteCarlo') {
    }

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
    balance: balances[balances.length - 1].amount,
    totalExpenses,
    totalIncome,
    totalTransfers,
    totalChange: balances[balances.length - 1].amount - balances[0].amount,
  };
}
