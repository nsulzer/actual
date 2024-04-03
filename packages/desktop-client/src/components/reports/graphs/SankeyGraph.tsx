// @ts-strict-ignore
import React from 'react';

import { css } from 'glamor';
import {
  Sankey,
  Tooltip,
  Rectangle,
  Layer,
  Sector,
  ResponsiveContainer
} from 'recharts';

import { amountToCurrency } from 'loot-core/src/shared/util';
import { type GroupedEntity } from 'loot-core/src/types/models/reports';

import { theme, type CSSProperties } from '../../../style';
import { PrivacyFilter } from '../../PrivacyFilter';
import { Container } from '../Container';
import { numberFormatterTooltip } from '../numberFormatter';

import { amountToInteger, integerToAmount } from '@actual-app/api/utils';

function SankeyNode({ x, y, width, height, index, payload, containerWidth }) {
  const isOut = x + width + 6 > containerWidth;
  let payloadValue = amountToCurrency(integerToAmount(payload.value));
  // if (payload.value < 1000) {
  //   payloadValue = '<1k';
  // } else {
  //   payloadValue = payloadValue + 'k';
  // }
  return (
    <Layer key={`CustomNode${index}`}>
      <Rectangle
        x={x}
        y={y}
        width={width}
        height={height}
        fill="#5192ca"
        fillOpacity="1"
      />
      <text
        textAnchor={isOut ? 'end' : 'start'}
        x={isOut ? x - 6 : x + width + 6}
        y={y + height / 2}
        fontSize="13"
      >
        {payload.name}
      </text>
      <PrivacyFilter>
        <text
          textAnchor={isOut ? 'end' : 'start'}
          x={isOut ? x - 6 : x + width + 6}
          y={y + height / 2 + 13}
          fontSize="9"
          strokeOpacity="0.5"
        >
          {payloadValue}
        </text>
      </PrivacyFilter>
    </Layer>
  );
}

function convertToSankey(data, groupBy: string) {
  // convert to nodes and edges
  // Split types:
  // Category:  Income Category -> Budget -> Group -> Category
  // Group:     Income          -> Budget -> Group
  // Payee:     Payee in -> Budget -> Payee Out
  // Accuount:  Account in balance -> Budget -> Account out balance (not totals)
  const nodes = [];
  const links = [];
  const nodeNames = [];

  nodes.push({ name: 'Budget' });
  nodeNames.push('Budget');

  if (groupBy === 'Category') {
    data.groupedData.forEach(group => {
      nodes.push({ name: group.name });
      nodeNames.push(group.name);
      if (group.totalTotals < 0) {
        links.push({
          source: 'Budget',
          target: group.name,
          value: -amountToInteger(group.totalTotals),
        });
      } else {
        links.push({
          source: group.name,
          target: 'Budget',
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
      {
        split.totalDebts < 0 && (
          links.push({
            source: 'Budget',
            target: split.name + 'out',
            value: -amountToInteger(split.totalDebts),
          })
        )
      };
      nodes.push({ name: split.name });
      nodeNames.push(split.name + 'in');
      {
        split.totalAssets > 0 && (
          links.push({
            source: split.name + 'in',
            target: 'Budget',
            value: amountToInteger(split.totalAssets),
          })
        )
      };
    })
  } else {  // Group or Payee
    data.data.forEach(split => {
      nodes.push({ name: split.name });
      nodeNames.push(split.name);
      if (split.totalTotals < 0) {
        links.push({
          source: 'Budget',
          target: split.name,
          value: -amountToInteger(split.totalTotals),
        });
      } else {
        links.push({
          source: split.name,
          target: 'Budget',
          value: amountToInteger(split.totalTotals),
        });
      }
    });
  };

  // Map source and target in links to the index of the node
  links.forEach(link => {
    link.source = nodeNames.findIndex(node => node === link.source);
    link.target = nodeNames.findIndex(node => node === link.target);
  });

  return {
    nodes: nodes,
    links: links
  }
}

type SankeyGraphProps = {
  style?: CSSProperties;
  data: GroupedEntity;
  groupBy: string;
  compact?: boolean;
  viewLabels: boolean;
};

export function SankeyGraph({
  style,
  data,
  groupBy,
  compact,
  viewLabels,
}: SankeyGraphProps) {

  const sankeyData = convertToSankey(data, groupBy)

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
        (sankeyData.links && sankeyData.links.length > 0) && (
          <ResponsiveContainer>
            <div>
              {!compact && <div style={{ marginTop: '15px' }} />}
              <Sankey
                width={width}
                height={height}
                data={sankeyData}
                node={compact ? null : props => <SankeyNode {...props} containerWidth={width} />}
                sort={true}
                iterations={1000}
                nodePadding={padding}
                margin={margin}
              >
                <Tooltip
                  formatter={numberFormatterTooltip}
                  isAnimationActive={false}
                  separator=": "
                />
              </Sankey>
            </div>
          </ResponsiveContainer>
        )
      }
    </Container>
  );
}
