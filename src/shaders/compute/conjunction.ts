/** Close-approach detection — counting-sort spatial hash + pair search. WGSL source: ./conjunction.wgsl */
import source from './conjunction.wgsl';
import scanSource from './conjunctionScan.wgsl';
import scanSubgroupsSource from './conjunctionScanSubgroups.wgsl';

export const CONJUNCTION_CS = source;
/** Bucket prefix sum, workgroup memory only. */
export const CONJUNCTION_SCAN_CS = scanSource;
/** Bucket prefix sum using `subgroups` — only valid on a device with the feature. */
export const CONJUNCTION_SCAN_SUBGROUPS_CS = scanSubgroupsSource;
