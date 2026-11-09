const { runReconciliationBatch, getReconciliationSummary, getReconciliationItems } = require('../src/services/reconciliationService');
const { pool } = require('../src/config/database');

async function testRecon() {
  console.log('Testing Three-Way Reconciliation for 2026-10-01 to 2026-11-09...');
  try {
    const runResult = await runReconciliationBatch({
      startDate: '2026-10-01',
      endDate: '2026-11-09',
      providerFilter: 'ALL',
      createdBy: 'test_runner',
    });

    console.log('Reconciliation Completed:', runResult);

    const summary = await getReconciliationSummary({ batchId: runResult.batchId });
    console.log('Summary Breakdown:', {
      batch: summary.batch.batch_no,
      statusBreakdown: summary.statusBreakdown,
      providerBreakdown: summary.providerBreakdown,
    });

    const sampleItems = await getReconciliationItems({
      batchId: runResult.batchId,
      page: 1,
      limit: 5,
    });
    console.log('Sample Items (5):', sampleItems.items.map(i => ({
      golden_reference: i.golden_reference,
      recon_status: i.recon_status,
      provider: i.provider,
      has_hrts: i.has_hrts,
      has_mw: i.has_middleware,
      has_pg: i.has_pg,
      hrts_amount: i.hrts_amount,
      pg_gross_amount: i.pg_gross_amount,
      pg_net_amount: i.pg_net_amount,
    })));
  } catch (err) {
    console.error('Test failed:', err);
  } finally {
    await pool.end();
  }
}

testRecon();

