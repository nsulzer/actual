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

import {amountToCurrency} from 'loot-core/src/shared/util';
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

function convertToSankey(data, compact:boolean) {
  // convert to nodes and edges
  // Income -> Budget -> Group -> Category TODO: Groups, other views
  const nodes = [];
  const links = [];
  const nodeNames = new Set();

  nodes.push({ name: 'Budget'});
  nodeNames.add('Budget');

  data.data.forEach(d => {
    nodes.push({ name: d.name });
    nodeNames.add(d.name);
    if (d.totalTotals < 0) {
      links.push({
        source: 'Budget',
        target: d.name,
        value: -amountToInteger(d.totalTotals),
      });
    } else {
      links.push({
        source: d.name,
        target: 'Budget',
        value: amountToInteger(d.totalTotals),
      });
    }
  });

    // Map source and target in links to the index of the node
    links.forEach(link => {
      link.source = nodes.findIndex(node => node.name === link.source);
      link.target = nodes.findIndex(node => node.name === link.target);
    });

  return {
    nodes: nodes,
    links: links
  }
}

type SankeyGraphProps = {
  style?: CSSProperties;
  data: GroupedEntity;
  balanceTypeOp: string;
  compact?: boolean;
  viewLabels: boolean;
};

export function SankeyGraph({
  style,
  data,
  balanceTypeOp,
  compact,
  viewLabels,
}: SankeyGraphProps) {

  const sankeyData = convertToSankey(data, compact)

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
                node={compact? null : props => <SankeyNode {...props} containerWidth={width} />}
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
