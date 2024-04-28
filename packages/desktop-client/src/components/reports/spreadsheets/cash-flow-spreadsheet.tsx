// @ts-strict-ignore
import React from 'react';

import * as d from 'date-fns';

import { runQuery } from 'loot-core/src/client/query-helpers';
import { type useSpreadsheet } from 'loot-core/src/client/SpreadsheetProvider';
import { send, sendCatch } from 'loot-core/src/platform/client/fetch';
import * as monthUtils from 'loot-core/src/shared/months';
import { q } from 'loot-core/src/shared/query';
import { integerToCurrency, integerToAmount } from 'loot-core/src/shared/util';
import { type RuleConditionEntity } from 'loot-core/types/models';

import { AlignedText } from '../../common/AlignedText';
import { runAll, indexCashFlow } from '../util';

export function simpleCashFlow(start, end) {
  return async (spreadsheet, setData) => {
    function makeQuery() {
      return q('transactions')
        .filter({
          $and: [{ date: { $gte: start } }, { date: { $lte: end } }],
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
  start: string,
  end: string,
  forecast,
  forecastSource: string,
  isConcise: boolean,
  conditions: RuleConditionEntity[] = [],
  conditionsOp: 'and' | 'or',
) {
  return async (
    spreadsheet: ReturnType<typeof useSpreadsheet>,
    setData: (data: ReturnType<typeof recalculate>) => void,
  ) => {
    const { filters } = await send('make-filters-from-conditions', {
      conditions: conditions.filter(cond => !cond.customName),
    });
    const conditionsOpKey = conditionsOp === 'or' ? '$or' : '$and';

    function makeQuery() {
      const query = q('transactions')
        .filter({
          [conditionsOpKey]: filters,
        })
        .filter({
          $and: [
            { date: { $transform: '$month', $gte: start } },
            { date: { $transform: '$month', $lte: end } },
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

    let scheduleQuery = q('schedules').select([
      '*',
      { isTransfer: '_payee.transfer_acct' },
      { isAccountOffBudget: '_account.offbudget' },
      { isPayeeOffBudget: '_payee.transfer_acct.offbudget' },
    ]);

    type ScheduleFilter = {
      account: string;
      payee: string;
    };
    const scheduleFilters = filters
      .map((filter: ScheduleFilter) => {
        if (filter.hasOwnProperty('account')) {
          const { account } = filter;
          return [{ _account: account }, { '_payee.transfer_acct': account }];
        }
        if (filter.hasOwnProperty('payee')) {
          const { payee } = filter;
          return { _payee: payee };
        }
        return filter;
      })
      .flat();

    if (scheduleFilters.length > 0) {
      scheduleQuery = scheduleQuery.filter({
        $or: [...scheduleFilters],
      });
    }

    const { data: scheduledata } = await runQuery(scheduleQuery);

    const schedules = await Promise.all(
      scheduledata.map(schedule => {
        if (typeof schedule._date !== 'string') {
          return sendCatch('schedule/get-occurrences-to-date', {
            config: schedule._date,
            end: forecast,
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

    const transactionQuery = q('transactions')
      .filter({
        [conditionsOpKey]: filters,
      })
      .filter({
        $and: [
          { date: { $transform: '$month', $lte: monthUtils.prevMonth(end) } },
        ],
        'account.offbudget': false,
      })
      .filter({ 'category.name': { $notlike: 'Starting Balances' } })
      .groupBy(['date', 'payee.transfer_acct'])
      .select([
        'date',
        { isTransfer: 'payee.transfer_acct' },
        { amount: { $sum: '$amount' } },
      ]);

    const { data: transactionDataAssets } = await runQuery(
      transactionQuery.filter({ amount: { $gt: 0 } }),
    );
    const { data: transactionDataDebts } = await runQuery(
      transactionQuery.filter({ amount: { $lt: 0 } }),
    );

    const transactions = await Promise.all(
      transactionDataAssets.concat(transactionDataDebts),
    );

    return runAll(
      [
        q('transactions')
          .filter({
            [conditionsOpKey]: filters,
            date: { $transform: '$month', $lt: start },
            'account.offbudget': false,
          })
          .calculate({ $sum: '$amount' }),
        makeQuery().filter({ amount: { $gt: 0 } }),
        makeQuery().filter({ amount: { $lt: 0 } }),
      ],
      data => {
        setData(
          recalculate(
            data,
            start,
            end,
            forecast,
            isConcise,
            schedules,
            transactions,
            filters,
            forecastSource,
          ),
        );
      },
    );
  };
}

function recalculate(
  data,
  start,
  end,
  forecast,
  isConcise: boolean,
  schedules,
  transactions,
  filters,
  forecastSource: string,
) {
  const [startingBalance, income, expense] = data;
  const convIncome = income.map(t => {
    return { ...t, isTransfer: t.isTransfer !== null };
  });
  const convExpense = expense.map(t => {
    return { ...t, isTransfer: t.isTransfer !== null };
  });

  const futureIncome = [];
  const futureExpense = [];
  if (forecastSource === 'schedule') {
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
  if (forecastSource === 'average') {
    const monthTotals = transactions.reduce((months, transaction) => {
      const year = monthUtils.getYear(transaction.date);
      const month = monthUtils.getMonthIndex(transaction.date); // Month is zero-indexed (0 = January)

      const assets = transaction.amount > 0 ? transaction.amount : 0;
      const debts = transaction.amount < 0 ? transaction.amount : 0;

      const yearData = {
        year,
        assets,
        debts,
      };
      const indexMonth = months.findIndex(a => a.month === month);

      if (indexMonth >= 0) {
        const indexYear = months[indexMonth].data.findIndex(
          d => d.year === year,
        );
        if (indexYear >= 0) {
          months[indexMonth].data[indexYear].assets += assets;
          months[indexMonth].data[indexYear].debts += debts;
        } else {
          months[indexMonth].data.push(yearData);
        }
      } else {
        months.push({
          month,
          data: [yearData],
        });
      }
      return months;
    }, []);

    const monthAvgs = monthTotals.reduce((arr, total) => {
      const sumAssets = total.data.reduce((sum, d) => sum + d.assets, 0);
      const sumDebts = total.data.reduce((sum, d) => sum + d.debts, 0);
      const averageAssets = Math.floor(
        sumAssets / total.data.filter(d => d.assets !== 0).length,
      );
      const averageDebts = Math.floor(
        sumDebts / total.data.filter(d => d.debts !== 0).length,
      );
      arr.push({
        month: total.month,
        averageAssets,
        averageDebts,
      });
      return arr;
    }, []);

    // Take an average of all months , weighted by the number of days
    const totalAvgAssets =
      monthAvgs.reduce((sum, d) => sum + d.averageAssets, 0) /
      monthAvgs.filter(d => d.averageAssets !== 0).length;
    const totalAvgDebts =
      monthAvgs.reduce((sum, d) => sum + d.averageDebts, 0) /
      monthAvgs.filter(d => d.averageDebts !== 0).length;

    monthUtils.range(end, forecast).forEach(month => {
      const currentAssets =
        month === monthUtils.currentMonth()
          ? income.find(d => d.date === month).amount
          : 0;
      const currentDebts =
        month === monthUtils.currentMonth()
          ? expense.find(d => d.date === month).amount
          : 0;

      const monthAvgIndex = monthAvgs.findIndex(
        m => m.month === monthUtils.getMonthIndex(month),
      );
      let ammounts = [];
      if (monthAvgIndex !== -1) {
        ammounts = [
          monthAvgs[monthAvgIndex].averageAssets - currentAssets,
          monthAvgs[monthAvgIndex].averageDebts - currentDebts,
        ];
      } else {
        ammounts = [
          Math.floor(totalAvgAssets) - currentAssets,
          Math.floor(totalAvgDebts) - currentDebts,
        ];
      }
      ammounts.forEach(a => {
        if (a < 0) {
          futureExpense.push({
            date: month,
            isTransfer: false,
            trasferAccount: null,
            amount: a,
          });
        } else {
          futureIncome.push({
            date: month,
            isTransfer: false,
            trasferAccount: null,
            amount: a,
          });
        }
      });
    });
  }

  const dates = isConcise
    ? monthUtils.rangeInclusive(
        monthUtils.getMonth(start),
        monthUtils.getMonth(end),
      )
    : monthUtils.dayRangeInclusive(start, end);

  let forecastDates;
  if (forecast === monthUtils.currentMonth()) {
    forecastDates = [];
  } else {
    forecastDates = isConcise
      ? monthUtils.rangeInclusive(
          monthUtils.getMonth(end),
          monthUtils.getMonth(forecast),
        )
      : monthUtils.dayRangeInclusive(end, forecast);
  }

  const incomes = indexCashFlow(convIncome, 'date', 'isTransfer');
  const expenses = indexCashFlow(convExpense, 'date', 'isTransfer');
  const futureIncomes = indexCashFlow(futureIncome, 'date', 'isTransfer');
  const futureExpenses = indexCashFlow(futureExpense, 'date', 'isTransfer');

  function calculate(dates, startingBalance, incomes, expenses) {
    let balance = startingBalance;
    let totalExpenses = 0;
    let totalIncome = 0;
    let totalTransfers = 0;

    const graphData = dates.reduce(
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
              <AlignedText left="Income:" right={integerToCurrency(income)} />
              <AlignedText
                left="Expenses:"
                right={integerToCurrency(expense)}
              />
              <AlignedText
                left="Change:"
                right={<strong>{integerToCurrency(income + expense)}</strong>}
              />
              {creditTransfers + debitTransfers !== 0 && (
                <AlignedText
                  left="Transfers:"
                  right={integerToCurrency(creditTransfers + debitTransfers)}
                />
              )}
              <AlignedText left="Balance:" right={integerToCurrency(balance)} />
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
    return { graphData, totalExpenses, totalIncome, totalTransfers };
  }

  const { graphData, totalExpenses, totalIncome, totalTransfers } = calculate(
    dates,
    startingBalance,
    incomes,
    expenses,
  );

  const { balances } = graphData;

  const {
    graphData: futureGraphData,
    totalExpenses: futureTotalExpenses,
    totalIncome: futureTotalIncome,
    totalTransfers: futureTotalTransfers,
  } = calculate(
    forecastDates,
    balances[balances.length - 1].amount,
    futureIncomes,
    futureExpenses,
  );

  graphData.futureBalances = futureGraphData.balances;
  graphData.futureIncome = futureGraphData.income;
  graphData.futureExpenses = futureGraphData.expenses;

  return {
    graphData,
    balance: balances[balances.length - 1].amount,
    totalExpenses: totalExpenses + futureTotalExpenses,
    totalIncome: totalIncome + futureTotalIncome,
    totalTransfers: totalTransfers + futureTotalTransfers,
    totalChange: balances[balances.length - 1].amount - balances[0].amount,
  };
}
