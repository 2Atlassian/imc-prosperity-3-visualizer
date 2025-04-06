import Highcharts from 'highcharts';
import { ReactNode } from 'react';
import { ProsperitySymbol } from '../../models.ts';
import { useStore } from '../../store.ts';
import { getAskColor, getBidColor } from '../../utils/colors.ts';
import { Chart } from './Chart.tsx';

export interface ProductPriceChartProps {
  symbol: ProsperitySymbol;
}

// Define an interface for the log row structure, assuming 'fairPrice' is added
// You might need to adjust this based on how you actually add the fair price
// to the activityLogs in the store.
interface ActivityLogRow {
  product: ProsperitySymbol;
  timestamp: number;
  bidPrices: number[];
  askPrices: number[];
  midPrice: number;
  fairPrice?: number; // Add the fairPrice property here (optional if it might not always exist)
  // Add other properties from your logs if needed for type safety
}

export function ProductPriceChart({ symbol }: ProductPriceChartProps): ReactNode {
  const algorithm = useStore(state => state.algorithm)!;

  // Cast activityLogs to the more specific type
  const activityLogs = (algorithm.activityLogs || []) as ActivityLogRow[];

  // 1. Add the 'Fair Value' series definition
  const series: Highcharts.SeriesOptionsType[] = [
    { type: 'line', name: 'Bid 3', color: getBidColor(0.5), marker: { symbol: 'square' }, data: [] },
    { type: 'line', name: 'Bid 2', color: getBidColor(0.75), marker: { symbol: 'circle' }, data: [] },
    { type: 'line', name: 'Bid 1', color: getBidColor(1.0), marker: { symbol: 'triangle' }, data: [] },
    { type: 'line', name: 'Mid price', color: 'gray', dashStyle: 'Dash', marker: { symbol: 'diamond' }, data: [] },
    // ADDED: Fair Value series definition (at index 4)
    {
      type: 'line',
      name: 'Fair Value', // Name for the legend
      color: 'purple', // Choose a distinct color
      dashStyle: 'ShortDot', // Choose a dash style (optional)
      marker: { enabled: true, symbol: 'cross' }, // Choose a marker (optional)
      data: [], // Initialize empty data array
    },
    // Original Ask series start here, indices are now shifted by 1
    { type: 'line', name: 'Ask 1', color: getAskColor(1.0), marker: { symbol: 'triangle-down' }, data: [] }, // Now index 5
    { type: 'line', name: 'Ask 2', color: getAskColor(0.75), marker: { symbol: 'circle' }, data: [] }, // Now index 6
    { type: 'line', name: 'Ask 3', color: getAskColor(0.5), marker: { symbol: 'square' }, data: [] }, // Now index 7
  ];

  // 2. Populate the data, including the new 'Fair Value' series
  for (const row of activityLogs) {
    if (row.product !== symbol) {
      continue;
    }

    // Populate Bids (indices 0, 1, 2 - unchanged)
    for (let i = 0; i < row.bidPrices.length; i++) {
      // Ensure data exists before pushing
      if (row.bidPrices[i] !== undefined && row.bidPrices[i] !== null) {
         (series[2 - i].data as Highcharts.PointOptionsObject[]).push({ x: row.timestamp, y: row.bidPrices[i] });
      }
    }

    // Populate Mid Price (index 3 - unchanged)
    if (row.midPrice !== undefined && row.midPrice !== null) {
        (series[3].data as Highcharts.PointOptionsObject[]).push({ x: row.timestamp, y: row.midPrice });
    }


    // ADDED: Populate Fair Value (at index 4)
    // Check if fairPrice exists on the row before trying to push it
    if (row.fairPrice !== undefined && row.fairPrice !== null) {
      (series[4].data as Highcharts.PointOptionsObject[]).push({ x: row.timestamp, y: row.fairPrice });
    }

    // Populate Asks (indices 5, 6, 7 - shifted by 1)
    for (let i = 0; i < row.askPrices.length; i++) {
       // Ensure data exists before pushing
       if (row.askPrices[i] !== undefined && row.askPrices[i] !== null) {
           // Use i + 5 now because we inserted Fair Value at index 4
          (series[i + 5].data as Highcharts.PointOptionsObject[]).push({ x: row.timestamp, y: row.askPrices[i] });
       }
    }
  }

  // Ensure data arrays are sorted by timestamp if necessary (Highcharts usually handles this if x values are sequential)
  // series.forEach(s => {
  //   if (s.data) {
  //     (s.data as Highcharts.PointOptionsObject[]).sort((a, b) => (a.x || 0) - (b.x || 0));
  //   }
  // });


  return <Chart title={`${symbol} - Price`} series={series} />;
}
