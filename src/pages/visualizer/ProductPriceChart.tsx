import Highcharts from 'highcharts';
// Import specific series option types
import type { SeriesLineOptions, PointOptionsObject } from 'highcharts'; // Keep these imports
import { ReactNode } from 'react';
import { ProsperitySymbol } from '../../models.ts';
import { useStore } from '../../store.ts';
import { getAskColor, getBidColor } from '../../utils/colors.ts';
import { Chart } from './Chart.tsx';

export interface ProductPriceChartProps {
  symbol: ProsperitySymbol;
}

// Define the log row structure (adjust if needed)
interface ActivityLogRow {
  product: ProsperitySymbol;
  timestamp: number;
  bidPrices: number[];
  askPrices: number[];
  midPrice: number;
  fairPrice?: number; // Added fairPrice
}

// REMOVED the unused 'LineSeriesWithOptions' type alias declaration

export function ProductPriceChart({ symbol }: ProductPriceChartProps): ReactNode {
  const algorithm = useStore(state => state.algorithm)!;
  const activityLogs = (algorithm.activityLogs || []) as ActivityLogRow[];

  // Initialize series array using SeriesLineOptions[]
  const series: SeriesLineOptions[] = [
    { type: 'line', name: 'Bid 3', color: getBidColor(0.5), marker: { symbol: 'square' }, data: [] },
    { type: 'line', name: 'Bid 2', color: getBidColor(0.75), marker: { symbol: 'circle' }, data: [] },
    { type: 'line', name: 'Bid 1', color: getBidColor(1.0), marker: { symbol: 'triangle' }, data: [] },
    { type: 'line', name: 'Mid price', color: 'gray', dashStyle: 'Dash', marker: { symbol: 'diamond' }, data: [] },
    { type: 'line', name: 'Fair Value', color: 'purple', dashStyle: 'ShortDot', marker: { enabled: true, symbol: 'cross' }, data: [] },
    { type: 'line', name: 'Ask 1', color: getAskColor(1.0), marker: { symbol: 'triangle-down' }, data: [] },
    { type: 'line', name: 'Ask 2', color: getAskColor(0.75), marker: { symbol: 'circle' }, data: [] },
    { type: 'line', name: 'Ask 3', color: getAskColor(0.5), marker: { symbol: 'square' }, data: [] },
  ];

  // Populate the data
  for (const row of activityLogs) {
    if (row.product !== symbol) {
      continue;
    }

    // Helper function to safely push data
    const pushData = (seriesIndex: number, value: number | undefined | null) => {
      if (value === undefined || value === null) return;
      const targetSeries = series[seriesIndex];
      if (targetSeries && Array.isArray(targetSeries.data)) {
         targetSeries.data.push({ x: row.timestamp, y: value });
      }
    };

    // Populate Bids (indices 0, 1, 2)
    for (let i = 0; i < row.bidPrices.length; i++) {
      pushData(2 - i, row.bidPrices[i]);
    }

    // Populate Mid Price (index 3)
    pushData(3, row.midPrice);

    // Populate Fair Value (index 4)
    pushData(4, row.fairPrice);

    // Populate Asks (indices 5, 6, 7)
    for (let i = 0; i < row.askPrices.length; i++) {
      pushData(i + 5, row.askPrices[i]);
    }
  }

  // Pass the series array to the Chart component
  // Cast back if Chart component props require the broader type
  return <Chart title={`${symbol} - Price`} series={series as Highcharts.SeriesOptionsType[]} />;
}
