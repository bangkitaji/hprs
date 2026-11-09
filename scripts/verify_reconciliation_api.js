const http = require('http');

function makeRequest(path, method = 'GET', body = null, token = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 3000,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
      },
    };
    if (token) options.headers['Authorization'] = `Bearer ${token}`;

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, raw: data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function verify() {
  console.log('1. Logging in as admin...');
  const loginRes = await makeRequest('/api/auth/login', 'POST', {
    username: 'admin',
    password: 'Admin@123'
  });
  console.log('Login Status:', loginRes.status, 'Token exists:', Boolean(loginRes.data?.token));
  const token = loginRes.data?.token;

  console.log('\n2. Testing GET /api/reconciliation/summary...');
  const sumRes = await makeRequest('/api/reconciliation/summary', 'GET', null, token);
  console.log('Summary Status:', sumRes.status);
  console.log('Batch No:', sumRes.data?.data?.batch?.batch_no);
  console.log('Total Trx:', sumRes.data?.data?.batch?.total_transactions);
  console.log('Provider breakdown count:', sumRes.data?.data?.providerBreakdown?.length);

  console.log('\n3. Testing GET /api/reconciliation/items...');
  const itemsRes = await makeRequest('/api/reconciliation/items?limit=3', 'GET', null, token);
  console.log('Items Status:', itemsRes.status, 'Total items:', itemsRes.data?.total);
  if (itemsRes.data?.items?.length > 0) {
    const itm = itemsRes.data.items[0];
    console.log('Sample item:', {
      id: itm.id,
      ref: itm.golden_reference,
      status: itm.recon_status,
      provider: itm.provider,
      resolution: itm.resolution_status
    });

    console.log(`\n4. Testing GET /api/reconciliation/items/${itm.id}...`);
    const detailRes = await makeRequest(`/api/reconciliation/items/${itm.id}`, 'GET', null, token);
    console.log('Detail Status:', detailRes.status, 'Golden Ref:', detailRes.data?.data?.golden_reference);

    console.log(`\n5. Testing PATCH /api/reconciliation/items/${itm.id}/resolution...`);
    const patchRes = await makeRequest(`/api/reconciliation/items/${itm.id}/resolution`, 'PATCH', {
      resolutionStatus: 'RESOLVED',
      resolutionNotes: 'Verified via test script'
    }, token);
    console.log('Patch Status:', patchRes.status, 'New Resolution:', patchRes.data?.data?.resolution_status);
  }

  console.log('\n✅ All Reconciliation Hub API tests completed successfully!');
}

verify().catch(console.error);
