const totalGraphOptions = [
  {
    description: 'TableGraph',
    disabledSplit: [],
    defaultSplit: 'Category',
    disabledType: [],
    defaultType: 'Payment',
    disableLegend: true,
    disableLabel: true,
  },
  {
    description: 'BarGraph',
    disabledSplit: [],
    defaultSplit: 'Category',
    disabledType: ['Net'],
    defaultType: 'Payment',
  },
  {
    description: 'AreaGraph',
    disabledSplit: ['Category', 'Group', 'Payee', 'Account'],
    defaultSplit: 'Interval',
    disabledType: [],
    defaultType: 'Payment',
    disableLegend: true,
  },
  {
    description: 'DonutGraph',
    disabledSplit: [],
    defaultSplit: 'Category',
    disabledType: ['Net'],
    defaultType: 'Payment',
  },
  {
    description: 'SankeyGraph',
    disabledSplit: ['Interval'],
    defaultSplit: 'Category',
    disabledType: [],
    defaultType: 'Net',
  },
];

const timeGraphOptions = [
  {
    description: 'TableGraph',
    disabledSplit: ['Interval'],
    defaultSplit: 'Category',
    disabledType: [],
    defaultType: 'Payment',
    disableLegend: true,
    disableLabel: true,
  },
  {
    description: 'StackedBarGraph',
    disabledSplit: ['Interval'],
    defaultSplit: 'Category',
    disabledType: ['Net'],
    defaultType: 'Payment',
  },
];

const modeOptions = [
  {
    description: 'total',
    graphs: totalGraphOptions,
    disabledGraph: [],
    defaultGraph: 'TableGraph',
  },
  {
    description: 'time',
    graphs: timeGraphOptions,
    disabledGraph: ['AreaGraph', 'DonutGraph', 'SankeyGraph'],
    defaultGraph: 'TableGraph',
  },
];

export const disabledList = {
  mode: modeOptions,
  modeGraphsMap: new Map(
    modeOptions.map(item => [item.description, item.disabledGraph]),
  ),
  graphSplitMap: new Map(
    modeOptions.map(item => [
      item.description,
      new Map([...item.graphs].map(f => [f.description, f.disabledSplit])),
    ]),
  ),
  graphTypeMap: new Map(
    modeOptions.map(item => [
      item.description,
      new Map([...item.graphs].map(f => [f.description, f.disabledType])),
    ]),
  ),
  graphLegendMap: new Map(
    modeOptions.map(item => [
      item.description,
      new Map([...item.graphs].map(f => [f.description, f.disableLegend])),
    ]),
  ),
  graphLabelsMap: new Map(
    modeOptions.map(item => [
      item.description,
      new Map([...item.graphs].map(f => [f.description, f.disableLabel])),
    ]),
  ),
};

export const defaultsList = {
  mode: modeOptions,
  modeGraphsMap: new Map(
    modeOptions.map(item => [item.description, item.defaultGraph]),
  ),
  graphSplitMap: new Map(
    modeOptions.map(item => [
      item.description,
      new Map([...item.graphs].map(f => [f.description, f.defaultSplit])),
    ]),
  ),
  graphTypeMap: new Map(
    modeOptions.map(item => [
      item.description,
      new Map([...item.graphs].map(f => [f.description, f.defaultType])),
    ]),
  ),
};
