import { useTranslation } from 'react-i18next';

import * as monthUtils from 'loot-core/src/shared/months';
import { type TimeFrame } from 'loot-core/types/models';

import { Input } from '../common/Input';
import { Select } from '../common/Select';
import { SpaceBetween } from '../common/SpaceBetween';
import { View } from '../common/View';
import { useResponsive } from '../responsive/ResponsiveProvider';

type ForecastHeaderProps = {
  allForecastSource: Array<{ name: string; pretty: string }>;
  allForecastMethods: Array<{ name: string; pretty: string }>;
  forecastSource: string;
  forecastMethod: string;
  averageMonths: number;
  averageYears: number;
  start: TimeFrame['start'];
  end: TimeFrame['end'];
  allMonths: Array<{ name: string; pretty: string }>;
  setAverageMonths: (averageMonths: number) => void;
  setAverageYears: (averageYears: number) => void;
  setForecastSource: (forecastSource: string) => void;
  setForecastMethod: (forecastMethod: string) => void;
  maxMonths: number;
};

export function ForecastHeader({
  allForecastSource,
  allForecastMethods,
  forecastSource,
  forecastMethod,
  averageMonths,
  averageYears,
  start,
  end,
  allMonths,
  setAverageMonths,
  setAverageYears,
  setForecastSource,
  setForecastMethod,
  maxMonths,
}: ForecastHeaderProps) {
  const { t } = useTranslation();
  const { isNarrowWidth } = useResponsive();

  return (
    <View
      style={{
        padding: 20,
        paddingTop: 15,
        flexShrink: 0,
      }}
    >
      <SpaceBetween
        direction={isNarrowWidth ? 'vertical' : 'horizontal'}
        style={{
          alignItems: isNarrowWidth ? 'flex-start' : 'center',
        }}
      >
        <SpaceBetween gap={isNarrowWidth ? 5 : undefined}>
          <SpaceBetween gap={5}>
            <View>{t('Forecast data:')}</View>
            <Select
              value={forecastSource}
              onChange={newNalue => setForecastSource(newNalue)}
              options={allForecastSource.map(({ name, pretty }) => [
                name,
                pretty,
              ])}
            />
          </SpaceBetween>
          {(forecastSource === 'transactions' ||
            forecastSource === 'budget') && (
            <SpaceBetween gap={5}>
              <View>{t('Method:')}</View>
              <Select
                value={forecastMethod}
                onChange={newNalue => setForecastMethod(newNalue)}
                options={allForecastMethods.map(({ name, pretty }) => [
                  name,
                  pretty,
                ])}
              />
              {forecastMethod === 'lastMonths' && (
                <SpaceBetween gap={5}>
                  <View>{t('of past')}</View>
                  <Input
                    type="number"
                    min={1}
                    max={maxMonths}
                    onChangeValue={newValue =>
                      setAverageMonths(Number(newValue))
                    }
                    value={averageMonths}
                    style={{ width: '50px' }}
                  />
                  <View>{t('months')}</View>
                </SpaceBetween>
              )}
              {forecastMethod === 'perMonth' && (
                <SpaceBetween gap={5}>
                  <View>{t('of past')}</View>
                  <Input
                    type="number"
                    min={1}
                    max={maxMonths}
                    onChangeValue={newValue =>
                      setAverageYears(Number(newValue))
                    }
                    value={averageYears}
                    style={{ width: '50px' }}
                  />
                  <View>{t('years')}</View>
                </SpaceBetween>
              )}
              {(forecastMethod === 'minAvgMax' ||
                forecastMethod === 'monteCarlo') && (
                <SpaceBetween gap={5}>
                  <View>{t('based on period')}</View>
                  <SpaceBetween gap={5}>
                    <Select
                      // onChange={newValue =>
                      //   onChangeDates(
                      //     ...validateStart(
                      //       allMonths[allMonths.length - 1].name,
                      //       newValue,
                      //       end,
                      //     ),
                      //   )
                      // }
                      value={start}
                      defaultLabel={monthUtils.format(start, 'MMMM, yyyy')}
                      options={allMonths.map(({ name, pretty }) => [
                        name,
                        pretty,
                      ])}
                    />
                    <View>{t('to')}</View>
                    <Select
                      // onChange={newValue =>
                      //   onChangeDates(
                      //     ...validateEnd(
                      //       allMonths[allMonths.length - 1].name,
                      //       start,
                      //       newValue,
                      //     ),
                      //   )
                      // }
                      value={end}
                      options={allMonths.map(({ name, pretty }) => [
                        name,
                        pretty,
                      ])}
                      style={{ marginRight: 10 }}
                    />
                  </SpaceBetween>
                </SpaceBetween>
              )}
            </SpaceBetween>
          )}
        </SpaceBetween>
      </SpaceBetween>
    </View>
  );
}
