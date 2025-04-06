import { Code, Text } from '@mantine/core';
import { ReactNode } from 'react';
import {
  ActivityLogRow,
  Algorithm,
  AlgorithmDataRow,
  AlgorithmSummary,
  CompressedAlgorithmDataRow,
  CompressedListing,
  CompressedObservations,
  CompressedOrder,
  CompressedOrderDepth,
  CompressedTrade,
  CompressedTradingState,
  ConversionObservation,
  Listing,
  Observation,
  Order,
  OrderDepth,
  Product,
  ProsperitySymbol,
  Trade,
  TradingState,
} from '../models.ts'; // Ensure ActivityLogRow in models.ts includes fairPrice?: number;
import { authenticatedAxios } from './axios.ts';

// --- AlgorithmParseError class (Keep as is) ---
export class AlgorithmParseError extends Error {
  public constructor(public readonly node: ReactNode) {
    super('Failed to parse algorithm logs');
  }
}

// --- getColumnValues function (Keep as is) ---
function getColumnValues(columns: string[], indices: number[]): number[] {
  const values: number[] = [];

  for (const index of indices) {
    const value = columns[index];
    // Check for empty string or non-numeric before parsing
    if (value !== '' && !isNaN(Number(value))) {
      values.push(parseFloat(value));
    } else if (value !== '') {
       // Log if a value exists but is not a number (might indicate format issue)
       // console.warn(`Column ${index} value "${value}" is not a number.`);
    }
    // If value is '', it's correctly skipped by the original logic
  }

  return values;
}

// --- getActivityLogs function (Keep as is - reverted, NO fairPrice calculation) ---
function getActivityLogs(logLines: string[]): ActivityLogRow[] {
    const headerIndex = logLines.indexOf('Activities log:');
    if (headerIndex === -1) {
        // It's better to return empty and let parseAlgorithmLogs handle the error if needed
        console.warn('Could not find "Activities log:" header.');
        return [];
    }

    const rows: ActivityLogRow[] = [];

    for (let i = headerIndex + 2; i < logLines.length; i++) {
        const line = logLines[i];
        // Stop if we hit the end of the section or another header (like 'Sandbox logs:')
        if (line === '' || line.endsWith(':')) {
            break;
        }

        const columns = line.split(';');
        // Increase check if more columns are expected (PNL is 16, so 17 columns 0-16)
        if (columns.length < 17) {
            console.warn(`Skipping malformed activity log line ${i + 1} (expected >=17 columns): ${line}`);
            continue;
        }

        const midPriceFromLog = parseFloat(columns[15]);
        const profitLoss = parseFloat(columns[16]);

        rows.push({
            day: parseInt(columns[0], 10),
            timestamp: parseInt(columns[1], 10),
            product: columns[2] as ProsperitySymbol, // Add type assertion
            bidPrices: getColumnValues(columns, [3, 5, 7]),
            bidVolumes: getColumnValues(columns, [4, 6, 8]),
            askPrices: getColumnValues(columns, [9, 11, 13]),
            askVolumes: getColumnValues(columns, [10, 12, 14]),
            midPrice: !isNaN(midPriceFromLog) ? midPriceFromLog : 0, // Default if NaN
            profitLoss: !isNaN(profitLoss) ? profitLoss : 0, // Default if NaN
            // fairPrice is NOT added here
        });
    }

     if (rows.length === 0 && headerIndex !== -1) {
       console.warn('Found "Activities log:" header but parsed no valid rows.');
     }

    return rows;
}


// --- All decompress* functions and getAlgorithmData (Keep as is) ---
function decompressListings(compressed: CompressedListing[]): Record<ProsperitySymbol, Listing> {
  const listings: Record<ProsperitySymbol, Listing> = {};
  for (const [symbol, product, denomination] of compressed) {
    listings[symbol] = { symbol, product, denomination };
  }
  return listings;
}

function decompressOrderDepths(
  compressed: Record<ProsperitySymbol, CompressedOrderDepth>,
): Record<ProsperitySymbol, OrderDepth> {
  const orderDepths: Record<ProsperitySymbol, OrderDepth> = {};
  for (const [symbol, [buyOrders, sellOrders]] of Object.entries(compressed)) {
    orderDepths[symbol] = { buyOrders, sellOrders };
  }
  return orderDepths;
}

function decompressTrades(compressed: CompressedTrade[]): Record<ProsperitySymbol, Trade[]> {
  const trades: Record<ProsperitySymbol, Trade[]> = {};
  for (const [symbol, price, quantity, buyer, seller, timestamp] of compressed) {
    if (trades[symbol] === undefined) {
      trades[symbol] = [];
    }
    trades[symbol].push({ symbol, price, quantity, buyer, seller, timestamp });
  }
  return trades;
}

function decompressObservations(compressed: CompressedObservations): Observation {
  const conversionObservations: Record<Product, ConversionObservation> = {};
  for (const [
    product,
    [bidPrice, askPrice, transportFees, exportTariff, importTariff, sugarPrice, sunlightIndex],
  ] of Object.entries(compressed[1])) {
    conversionObservations[product] = {
      bidPrice, askPrice, transportFees, exportTariff, importTariff, sugarPrice, sunlightIndex,
    };
  }
  return {
    plainValueObservations: compressed[0],
    conversionObservations,
  };
}

function decompressState(compressed: CompressedTradingState): TradingState {
  // Note: compressed[1] is the traderData string extracted from the state part
  //       compressed[3] below is the separate traderData string passed to logger.flush
  return {
    timestamp: compressed[0],
    traderData: compressed[1], // This is state.traderData from Python side
    listings: decompressListings(compressed[2]),
    orderDepths: decompressOrderDepths(compressed[3]),
    ownTrades: decompressTrades(compressed[4]),
    marketTrades: decompressTrades(compressed[5]),
    position: compressed[6],
    observations: decompressObservations(compressed[7]),
  };
}

function decompressOrders(compressed: CompressedOrder[]): Record<ProsperitySymbol, Order[]> {
  const orders: Record<ProsperitySymbol, Order[]> = {};
  for (const [symbol, price, quantity] of compressed) {
    if (orders[symbol] === undefined) {
      orders[symbol] = [];
    }
    orders[symbol].push({ symbol, price, quantity });
  }
  return orders;
}

function decompressDataRow(compressed: CompressedAlgorithmDataRow, sandboxLogs: string): AlgorithmDataRow {
   // compressed[3] is the traderData string passed separately to logger.flush
  return {
    state: decompressState(compressed[0]),
    orders: decompressOrders(compressed[1]),
    conversions: compressed[2],
    traderData: compressed[3], // This is the one we need for fairPrice
    algorithmLogs: compressed[4],
    sandboxLogs,
  };
}

function getAlgorithmData(logLines: string[]): AlgorithmDataRow[] {
    const headerIndex = logLines.indexOf('Sandbox logs:');
    if (headerIndex === -1) {
         console.warn('Could not find "Sandbox logs:" header.');
        return [];
    }

    const rows: AlgorithmDataRow[] = [];
    let nextSandboxLogs = '';

    const sandboxLogPrefix = '  "sandboxLog": ';
    const lambdaLogPrefix = '  "lambdaLog": ';

    for (let i = headerIndex + 1; i < logLines.length; i++) {
        const line = logLines[i];
        // Stop if we hit the next major header like 'Activities log:'
        if (line.endsWith(':') && !line.startsWith(' ')) {
            break;
        }

        if (line.startsWith(sandboxLogPrefix)) {
            try {
                 // Extract content within quotes, handle potential escapes if necessary
                 const rawContent = line.substring(sandboxLogPrefix.length + 1, line.length - (line.endsWith(',') ? 2 : 1));
                nextSandboxLogs = JSON.parse(`"${rawContent}"`).trim(); // Parse as JSON string then trim
            } catch(err) {
                 console.warn(`Failed to parse sandboxLog line ${i+1}: ${line}`, err);
                 nextSandboxLogs = ''; // Reset on error
            }

            continue;
        }

        if (!line.startsWith(lambdaLogPrefix) || line === '  "lambdaLog": "",') {
            continue;
        }

        // Attempt to parse the compressed data row JSON from lambdaLog
        const start = line.indexOf('[['); // Start of state array
         // Find the correct closing brackets for the entire lambdaLog payload
         // It should end with ']]' for the state, then ']', number, 'string', 'string']'
         // Finding the balanced closing bracket for the outer array is tricky if logs are truncated/malformed
         // Let's try finding the last ']' as a heuristic
        const end = line.lastIndexOf(']') + 1;


        if (start === -1 || end === 0 || start >= end) {
            console.warn(`Could not find valid data structure in lambdaLog line ${i+1}: ${line}`);
            continue; // Skip if structure seems wrong
        }


        try {
            // The data seems to be double-encoded JSON string within the log string
            const jsonString = line.substring(start, end);
            // We need to parse the outer JSON string first, then the inner JSON array
             const parsedJsonString = JSON.parse(`"${jsonString}"`); // Parse the string content
            const compressedDataRow = JSON.parse(parsedJsonString); // Parse the actual array

            // Basic validation of the expected structure
             if (!Array.isArray(compressedDataRow) || compressedDataRow.length < 5) {
                 throw new Error("Parsed lambdaLog data is not the expected array structure.");
             }


            rows.push(decompressDataRow(compressedDataRow, nextSandboxLogs));
        } catch (err) {
            console.warn(`Failed to parse lambdaLog line ${i + 1}. Maybe truncated or invalid JSON? Line:`, line);
            console.error('Parsing error:', err);
            // Removed throwing AlgorithmParseError here to allow potentially partial processing
            // Consider if throwing is desired behavior on lambdaLog parse errors
            /*
            throw new AlgorithmParseError(
                <>
                    <Text size="sm">Error parsing lambdaLog data. Line:</Text>
                    <Text size="sm">{line}</Text>
                </>
            );
            */
        }
    }

     if (rows.length === 0 && headerIndex !== -1) {
       console.warn('Found "Sandbox logs:" header but parsed no valid rows.');
     }

    return rows;
}


// --- MODIFIED parseAlgorithmLogs function ---
export function parseAlgorithmLogs(logs: string, summary?: AlgorithmSummary): Algorithm {
    const logLines = logs.trim().split(/\r?\n/);

    // 1. Parse standard activities (NO fairPrice added here)
    const activityLogs: ActivityLogRow[] = getActivityLogs(logLines);

    // 2. Parse sandbox logs (extracts state including traderData string)
    const data: AlgorithmDataRow[] = getAlgorithmData(logLines);

    // --- 3. NEW STEP: Merge fairPrice from traderData into activityLogs ---
    console.log("Starting merge step. ActivityLogs count:", activityLogs.length, "DataRows count:", data.length);

    // Create a quick lookup map for AlgorithmDataRow by timestamp
    const dataRowMap = new Map<number, AlgorithmDataRow>();
    for (const dataRow of data) {
        // state.timestamp should exist if dataRow is valid
        if (dataRow.state && typeof dataRow.state.timestamp === 'number') {
             dataRowMap.set(dataRow.state.timestamp, dataRow);
        } else {
            console.warn("DataRow found without valid state or timestamp:", dataRow);
        }
    }
    console.log("Created dataRowMap with size:", dataRowMap.size);

    let mergeCount = 0;
    // Iterate through activityLogs and add fairPrice
    for (const activityRow of activityLogs) {
        // Find the corresponding AlgorithmDataRow using the timestamp
        const correspondingDataRow = dataRowMap.get(activityRow.timestamp);

        // Check if we found a matching data row and if it contains traderData
        if (correspondingDataRow && correspondingDataRow.traderData) {
            try {
                // Parse the traderData JSON string (assuming it's standard JSON now)
                const parsedTraderData = JSON.parse(correspondingDataRow.traderData);

                // Look for the 'current_fair_prices' dictionary added in Python
                if (parsedTraderData && parsedTraderData.current_fair_prices) {
                    // Get the fair price for the specific product of this activity row
                    const fairPriceForProduct = parsedTraderData.current_fair_prices[activityRow.product];

                    // Assign it IF it exists AND is a valid number
                    if (typeof fairPriceForProduct === 'number' && !isNaN(fairPriceForProduct)) {
                        activityRow.fairPrice = fairPriceForProduct;
                        mergeCount++;
                        // Optional: Log successful merge for debugging
                        // if (mergeCount < 10) { // Log only first few merges
                        //    console.log(`Merged fair price ${fairPriceForProduct} for ${activityRow.product} at ${activityRow.timestamp}`);
                        // }
                    } else {
                        activityRow.fairPrice = undefined; // Explicitly set to undefined if not found/valid
                    }
                } else {
                    // 'current_fair_prices' key missing in parsed traderData
                    activityRow.fairPrice = undefined;
                }
            } catch (e) {
                // Handle potential JSON parsing errors for traderData
                console.warn(`Failed to parse traderData JSON at timestamp ${activityRow.timestamp}. Data: "${correspondingDataRow.traderData}"`, e);
                activityRow.fairPrice = undefined;
            }
        } else {
            // No matching traderData found for this timestamp, or traderData was empty
            activityRow.fairPrice = undefined;
        }
    }
    console.log(`Finished merge step. Added/updated fairPrice for ${mergeCount} activity log rows.`);
    // --- END MERGE STEP ---

    // --- Original validation checks (modified slightly for clarity) ---
    if (activityLogs.length === 0 && data.length === 0) {
         console.error("Parsing Error: Both activityLogs and data arrays are empty.");
        throw new AlgorithmParseError(
             "Logs are empty, either something went wrong during with your submission or your backtester logs in a different format than Prosperity's submission environment.",
         );
    }

    if (activityLogs.length === 0) {
         console.error("Parsing Error: activityLogs array is empty.");
         throw new AlgorithmParseError(
             /* prettier-ignore */
             <Text size="sm">Invalid log format: Could not parse the 'Activities log' section. Check if it exists and follows the expected semicolon-separated format.</Text>,
         );
    }

     if (data.length === 0) {
         console.error("Parsing Error: data array (from Sandbox/Lambda logs) is empty.");
         throw new AlgorithmParseError(
             /* prettier-ignore */
             <Text size="sm">Invalid log format: Could not parse the 'Sandbox logs' / 'lambdaLog' section containing the compressed state and traderData. Ensure <Code>logger.flush()</Code> is called and producing output.</Text>,
         );
     }
    // --- End validation checks ---

    // Return the final algorithm object, now with fairPrice potentially added to activityLogs
    return {
        summary,
        activityLogs, // These rows now potentially have .fairPrice attached
        data,
    };
}


// --- Keep the other functions below (getAlgorithmLogsUrl, download*, etc.) ---

export async function getAlgorithmLogsUrl(algorithmId: string): Promise<string> {
  const urlResponse = await authenticatedAxios.get(
    `https://bz97lt8b1e.execute-api.eu-west-1.amazonaws.com/prod/submission/logs/${algorithmId}`,
  );
  return urlResponse.data;
}

function downloadFile(url: string): void {
  const link = document.createElement('a');
  link.href = url;
  // Use a more generic name or try to get it from summary if available
  link.download = new URL(url).pathname.split('/').pop() || 'download.log';
  link.target = '_blank';
  link.rel = 'noreferrer';

  document.body.appendChild(link);
  link.click();
  link.remove();
}

export async function downloadAlgorithmLogs(algorithmId: string): Promise<void> {
  const logsUrl = await getAlgorithmLogsUrl(algorithmId);
  downloadFile(logsUrl);
}

export async function downloadAlgorithmResults(algorithmId: string): Promise<void> {
  const detailsResponse = await authenticatedAxios.get(
    // Assuming this endpoint provides the activitiesLog URL in the summary
    `https://bz97lt8b1e.execute-api.eu-west-1.amazonaws.com/prod/results/tutorial/${algorithmId}`,
  );

  // Check structure before accessing deeply nested property
  if (detailsResponse?.data?.algo?.summary?.activitiesLog) {
     downloadFile(detailsResponse.data.algo.summary.activitiesLog);
  } else {
      console.error("Could not find activitiesLog URL in results response:", detailsResponse.data);
      // Maybe alert the user or handle the error appropriately
  }
}
