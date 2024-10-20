// @ts-strict-ignore
import React, { useState, Component } from 'react';
import { useTranslation } from 'react-i18next';

import { amountToInteger, integerToAmount } from '@actual-app/api/utils';
import { css } from 'glamor';
import {
  Sankey,
  Tooltip,
  Rectangle,
  Layer,
  ResponsiveContainer,
} from 'recharts';

import { amountToCurrency } from 'loot-core/src/shared/util';
import {
  type balanceTypeOpType,
  type DataEntity,
} from 'loot-core/src/types/models/reports';
import { type RuleConditionEntity } from 'loot-core/types/models/rule';

import { useAccounts } from '../../../hooks/useAccounts';
import { useCategories } from '../../../hooks/useCategories';
import { useNavigate } from '../../../hooks/useNavigate';
import { theme, type CSSProperties } from '../../../style';
import { AlignedText } from '../../common/AlignedText';
import { PrivacyFilter } from '../../PrivacyFilter';
import { Container } from '../Container';
import { numberFormatterTooltip } from '../numberFormatter';

import { showActivity } from './showActivity';

type PayloadItem = {
  name: string;
  value: number;
  payload: {
    payload: {
      name: string;
      source: {
        name: string;
      };
      target: {
        name: string;
      };
    };
  };
};

type CustomTooltipProps = {
  active?: boolean;
  payload?: PayloadItem[];
  balanceTypeOp: balanceTypeOpType;
};

const CustomTooltip = ({ active, payload }: CustomTooltipProps) => {
  const { t } = useTranslation();
  if (active && payload && payload.length) {
    return (
      <div
        className={`${css({
          zIndex: 1000,
          pointerEvents: 'none',
          borderRadius: 2,
          boxShadow: '0 1px 6px rgba(0, 0, 0, .20)',
          backgroundColor: theme.menuBackground,
          color: theme.menuItemText,
          padding: 10,
        })}`}
      >
        <div>
          {payload[0].payload.payload.source && (
            <div style={{ marginBottom: 10 }}>
              {t('From')}{' '}
              <strong>{payload[0].payload.payload.source.name}</strong>{' '}
              {t('to')}{' '}
              <strong>{payload[0].payload.payload.target.name}</strong>
            </div>
          )}
          {payload[0].payload.payload.name && (
            <div style={{ marginBottom: 10 }}>
              <strong>{payload[0].name}</strong>
            </div>
          )}
          <div style={{ lineHeight: 1.5 }}>
            <AlignedText
              left=""
              right={
                <PrivacyFilter>
                  {amountToCurrency(integerToAmount(payload[0].value))}
                </PrivacyFilter>
              }
            />
          </div>
        </div>
      </div>
    );
  }

  return <div />;
};

function SankeyNode({
  x,
  y,
  width,
  height,
  index,
  payload,
  containerWidth,
  compact,
  viewLabels,
  style,
  onMouseLeave,
  onMouseEnter,
  onClick,
}) {
  const isOut = x + width + 6 > containerWidth;
  const payloadValue = amountToCurrency(integerToAmount(payload.value));

  const display = compact ? 'none' : 'inline';

  return (
    <Layer key={`CustomNode${index}`}>
      <Rectangle
        x={x}
        y={y}
        width={width}
        height={height}
        fill={payload.color}
        fillOpacity="1"
        style={style}
        onMouseLeave={onMouseLeave}
        onMouseEnter={onMouseEnter}
        onClick={onClick}
      />
      <text
        textAnchor={isOut ? 'end' : 'start'}
        x={isOut ? x - 6 : x + width + 6}
        y={y + height / 2}
        fontSize="13"
        fill={theme.pageText}
        display={display}
        dominantBaseline={viewLabels ? 'auto' : 'middle'}
      >
        {payload.name}
      </text>
      {viewLabels && (
        <text
          textAnchor={isOut ? 'end' : 'start'}
          x={isOut ? x - 6 : x + width + 6}
          y={y + height / 2 + 13}
          fontSize="10"
          strokeOpacity="1"
          fill={theme.pageText}
          display={display}
        >
          <PrivacyFilter>{payloadValue}</PrivacyFilter>
        </text>
      )}
      )
    </Layer>
  );
}

function ConvertToSankey(data, groupBy: string) {
  // convert to nodes and edges
  // Split types:
  // Category:  Income Category -> Budget -> Group -> Category
  // Group:     Income          -> Budget -> Group
  // Payee:     Payee in -> Budget -> Payee Out
  // Accuount:  Account in balance -> Budget -> Account out balance (not totals)
  const nodes = [];
  const links = [];
  const nodeNames = [];

  const { t } = useTranslation();

  nodes.push({ name: t('Budget') });
  nodeNames.push(t('Budget'));

  if (groupBy === 'Category' && data.groupedData) {
    data.groupedData.forEach(group => {
      nodes.push({ name: group.name });
      nodeNames.push(group.name);
      if (group.totalTotals < 0) {
        links.push({
          source: t('Budget'),
          target: group.name,
          value: -amountToInteger(group.totalTotals),
        });
      } else {
        links.push({
          source: group.name,
          target: t('Budget'),
          value: amountToInteger(group.totalTotals),
        });
      }
      group.categories.forEach(category => {
        nodes.push({ name: category.name });
        nodeNames.push(group.name + category.name);
        if (category.totalTotals < 0) {
          links.push({
            source: group.name,
            target: group.name + category.name,
            value: -amountToInteger(category.totalTotals),
          });
        } else {
          links.push({
            source: group.name + category.name,
            target: group.name,
            value: amountToInteger(category.totalTotals),
          });
        }
      });
    });
  } else if (groupBy === 'Account') {
    data.data.forEach(split => {
      nodes.push({ name: split.name });
      nodeNames.push(split.name + 'out');
      if (split.totalDebts < 0) {
        links.push({
          source: t('Budget'),
          target: split.name + 'out',
          value: -amountToInteger(split.totalDebts),
        });
      }
      nodes.push({ name: split.name });
      nodeNames.push(split.name + 'in');
      if (split.totalAssets > 0) {
        links.push({
          source: split.name + 'in',
          target: t('Budget'),
          value: amountToInteger(split.totalAssets),
        });
      }
    });
  } else {
    // Group or Payee
    data.data.forEach(split => {
      nodes.push({ name: split.name });
      nodeNames.push(split.name);
      if (split.totalTotals < 0) {
        links.push({
          source: t('Budget'),
          target: split.name,
          value: -amountToInteger(split.totalTotals),
        });
      } else {
        links.push({
          source: split.name,
          target: t('Budget'),
          value: amountToInteger(split.totalTotals),
        });
      }
    });
  }

  // Map source and target in links to the index of the node
  links.forEach(link => {
    link.source = nodeNames.findIndex(node => node === link.source);
    link.target = nodeNames.findIndex(node => node === link.target);
  });

  nodes.forEach(node => {
    const result = data.legend.find(leg => leg.name === node.name);
    if (result !== undefined) {
      node.color = result.color;
    } else {
      node.color = theme.pageTextLight;
    }
  });

  return {
    nodes,
    links,
  };
}

class SankeyLink extends Component<any, any> {
  render() {
    const {
      sourceX,
      targetX,
      sourceY,
      targetY,
      sourceControlX,
      targetControlX,
      linkWidth,
      index,
    } = this.props;
    return (
      <Layer key={`CustomLink${index}`}>
        <path
          d={`
            M ${sourceX}        ,${sourceY + linkWidth / 2}
            C ${sourceControlX} ,${sourceY + linkWidth / 2}
              ${targetControlX} ,${targetY + linkWidth / 2}
              ${targetX}        ,${targetY + linkWidth / 2}
            L ${targetX}        ,${targetY - linkWidth / 2}
            C ${targetControlX} ,${targetY - linkWidth / 2}
              ${sourceControlX} ,${sourceY - linkWidth / 2}
              ${sourceX}        ,${sourceY - linkWidth / 2}
            Z
          `}
          fill={theme.pageBackground}
        />
      </Layer>
    );
  }
}

type SankeyGraphProps = {
  style?: CSSProperties;
  data: DataEntity;
  filters: RuleConditionEntity[];
  groupBy: string;
  balanceTypeOp: balanceTypeOpType;
  compact?: boolean;
  viewLabels: boolean;
  showHiddenCategories?: boolean;
  showOffBudget?: boolean;
  showTooltip?: boolean;
};

export function SankeyGraph({
  style,
  data,
  filters,
  groupBy,
  balanceTypeOp,
  compact,
  viewLabels,
  showHiddenCategories,
  showOffBudget,
  showTooltip = true,
}: SankeyGraphProps) {
  const navigate = useNavigate();
  const categories = useCategories();
  const accounts = useAccounts();
  const [pointer, setPointer] = useState('');

  const sankeyData = ConvertToSankey(data, groupBy);

  const margin = {
    left: 0,
    right: 0,
    top: 0,
    bottom: compact ? 0 : 25,
  };

  const padding = compact ? 4 : 23;

  return (
    <Container
      style={{
        ...style,
        ...(compact && { height: 'auto' }),
      }}
    >
      {(width, height) =>
        sankeyData.links &&
        sankeyData.links.length > 0 && (
          <ResponsiveContainer>
            <div>
              {!compact && <div style={{ marginTop: '15px' }} />}
              <Sankey
                width={width}
                height={height}
                data={sankeyData}
                node={props => (
                  <SankeyNode
                    {...props}
                    containerWidth={width}
                    compact={compact}
                    viewLabels={viewLabels}
                    style={{ cursor: pointer }}
                    onMouseLeave={() => setPointer('')}
                    onMouseEnter={() =>
                      !['Group', 'Interval'].includes(groupBy) &&
                      setPointer('pointer')
                    }
                    onClick={item =>
                      ((compact && showTooltip) || !compact) &&
                      !['Group', 'Interval'].includes(groupBy) &&
                      showActivity({
                        navigate,
                        categories,
                        accounts,
                        balanceTypeOp,
                        filters,
                        showHiddenCategories,
                        showOffBudget,
                        type: 'totals',
                        startDate: data.startDate,
                        endDate: data.endDate,
                        field: groupBy.toLowerCase(),
                        id: item.id,
                      })
                    }
                  />
                )}
                sort={true}
                nodePadding={padding}
                margin={margin}
                link={<SankeyLink />}
                linkCurvature={0.25}
              >
                {showTooltip && (
                  <Tooltip
                    content={<CustomTooltip balanceTypeOp={balanceTypeOp} />}
                    formatter={numberFormatterTooltip}
                    isAnimationActive={false}
                  />
                )}
              </Sankey>
            </div>
          </ResponsiveContainer>
        )
      }
    </Container>
  );
}
