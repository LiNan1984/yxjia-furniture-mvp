import { test, expect } from '@playwright/test';
import http from 'http';
import fs from 'fs';
import path from 'path';

const BASE_URL = 'http://127.0.0.1:3000';
const DATA_DIR = path.join(process.cwd(), 'data');
const PRODUCTS_FILE = path.join(DATA_DIR, 'products.json');
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');

const REQUIRED_PRODUCT_IDS = ['sofa-1', 'sofa-2', 'sofa-3', 'cabinet-1', 'bed-1', 'table-1'];

function makeRequest(method, urlPath, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE_URL);
    const options = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: { 'Content-Type': 'application/json' }
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null });
        } catch (e) {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

test.afterAll(() => {
  // 跑完测试后清空 orders.json
  fs.writeFileSync(ORDERS_FILE, JSON.stringify({ orders: [] }, null, 2), 'utf-8');
});

test.describe('Server - Basic endpoints (port 3000)', () => {
  test('GET / serves the index HTML page', async () => {
    const res = await makeRequest('GET', '/');
    expect(res.status).toBe(200);
    expect(typeof res.body).toBe('string');
    expect(res.body).toContain('银杏家具');
  });

  test('GET / serves on port 3000', async () => {
    const res = await makeRequest('GET', '/');
    expect(res.status).toBe(200);
  });

  test('GET /product.html serves the product page', async () => {
    const res = await makeRequest('GET', '/product.html');
    expect(res.status).toBe(200);
    expect(typeof res.body).toBe('string');
  });

  test('GET /checkout.html serves the checkout page', async () => {
    const res = await makeRequest('GET', '/checkout.html');
    expect(res.status).toBe(200);
    expect(typeof res.body).toBe('string');
  });

  test('GET /order.html serves the order page', async () => {
    const res = await makeRequest('GET', '/order.html');
    expect(res.status).toBe(200);
    expect(typeof res.body).toBe('string');
  });
});

test.describe('Product detail route /product/:id', () => {
  test('GET /product/sofa-1 returns HTML page', async () => {
    const res = await makeRequest('GET', '/product/sofa-1');
    expect(res.status).toBe(200);
    expect(typeof res.body).toBe('string');
    expect(res.body).toContain('银杏家具');
  });

  test('GET /product/bed-1 returns HTML page', async () => {
    const res = await makeRequest('GET', '/product/bed-1');
    expect(res.status).toBe(200);
    expect(typeof res.body).toBe('string');
  });

  test('GET /product/non-existent still serves page (page loads, content via JS)', async () => {
    const res = await makeRequest('GET', '/product/non-existent-id');
    expect(res.status).toBe(200);
  });
});

test.describe('Products API', () => {
  test('GET /api/products returns products in ApiResponse shape', async () => {
    const res = await makeRequest('GET', '/api/products');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('products');
    expect(Array.isArray(res.body.data.products)).toBe(true);
  });

  test('Products include exactly the six required types', async () => {
    const res = await makeRequest('GET', '/api/products');
    const ids = res.body.data.products.map(p => p.id);
    for (const id of REQUIRED_PRODUCT_IDS) {
      expect(ids).toContain(id);
    }
    expect(res.body.data.products.length).toBeGreaterThanOrEqual(6);
  });

  test('Products include sofa-1, sofa-2, sofa-3 (three sofas)', async () => {
    const res = await makeRequest('GET', '/api/products');
    const sofas = res.body.data.products.filter(p => p.id.startsWith('sofa-'));
    expect(sofas.length).toBe(3);
  });

  test('Products include table-1 (dining table), no wardrobe', async () => {
    const res = await makeRequest('GET', '/api/products');
    const ids = res.body.data.products.map(p => p.id);
    expect(ids).toContain('table-1');
    expect(ids).not.toContain('wardrobe');
  });

  test('Each product has required fields', async () => {
    const res = await makeRequest('GET', '/api/products');
    const product = res.body.data.products[0];
    expect(product).toHaveProperty('id');
    expect(product).toHaveProperty('name');
    expect(product).toHaveProperty('price');
    expect(product).toHaveProperty('size');
  });

  test('Price fields use ¥-band format (¥Xxxx 起)', async () => {
    const res = await makeRequest('GET', '/api/products');
    const hasBand = res.body.data.products.some(p =>
      typeof p.price === 'string' && /^¥\d+xxx/.test(p.price)
    );
    expect(hasBand).toBe(true);
  });

  test('GET /api/products/sofa-1 returns single product', async () => {
    const res = await makeRequest('GET', '/api/products/sofa-1');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.product.id).toBe('sofa-1');
  });

  test('GET /api/products/:id returns 404 for unknown product', async () => {
    const res = await makeRequest('GET', '/api/products/wardrobe-xyz');
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  test('Products data file exists and is valid JSON', async () => {
    expect(fs.existsSync(PRODUCTS_FILE)).toBe(true);
    const data = JSON.parse(fs.readFileSync(PRODUCTS_FILE, 'utf-8'));
    expect(data).toHaveProperty('products');
  });
});

test.describe('Orders API', () => {
  test('GET /api/orders returns orders in ApiResponse shape', async () => {
    const res = await makeRequest('GET', '/api/orders');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('orders');
    expect(Array.isArray(res.body.data.orders)).toBe(true);
  });

  test('POST /api/orders creates a new order', async () => {
    const newOrder = {
      name: '张三',
      phone: '13800138000',
      productId: 'sofa-1',
      address: '来店自提',
      spec: '3.4米·米灰',
      quantity: 1
    };
    const res = await makeRequest('POST', '/api/orders', newOrder);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const order = res.body.data.order;
    expect(order.name).toBe('张三');
    expect(order.phone).toBe('13800138000');
    expect(order.productId).toBe('sofa-1');
    expect(order.address).toBe('来店自提');
    expect(order).toHaveProperty('id');
    expect(order).toHaveProperty('status');
    expect(order).toHaveProperty('createdAt');
  });

  test('POST /api/orders requires name', async () => {
    const res = await makeRequest('POST', '/api/orders', { phone: '13800138000', productId: 'sofa-1' });
    expect(res.status).toBe(400);
  });

  test('POST /api/orders requires phone', async () => {
    const res = await makeRequest('POST', '/api/orders', { name: '李四', productId: 'sofa-1' });
    expect(res.status).toBe(400);
  });

  test('POST /api/orders requires productId', async () => {
    const res = await makeRequest('POST', '/api/orders', { name: '王五', phone: '13800138000' });
    expect(res.status).toBe(400);
  });

  test('POST /api/orders validates phone format (11 digits, 1[3-9] prefix)', async () => {
    const res = await makeRequest('POST', '/api/orders', {
      name: '测试', phone: 'invalid', productId: 'sofa-1'
    });
    expect(res.status).toBe(400);
  });

  test('POST /api/orders validates product exists', async () => {
    const res = await makeRequest('POST', '/api/orders', {
      name: '测试', phone: '13800138000', productId: 'unknown-xyz'
    });
    expect(res.status).toBe(404);
  });

  test('GET /api/orders/:phone filters by phone number', async () => {
    const phone = '13900139001';
    await makeRequest('POST', '/api/orders', {
      name: '按手机查', phone, productId: 'sofa-2'
    });
    await makeRequest('POST', '/api/orders', {
      name: '其他', phone: '13700137000', productId: 'bed-1'
    });
    const res = await makeRequest('GET', `/api/orders/${phone}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.orders.length).toBeGreaterThan(0);
    res.body.data.orders.forEach(o => expect(o.phone).toBe(phone));
  });

  test('GET /api/orders/:phone returns empty list for unknown phone', async () => {
    const res = await makeRequest('GET', '/api/orders/10000000000');
    expect(res.status).toBe(200);
    expect(res.body.data.orders).toEqual([]);
  });

  test('Order persists to orders.json file', async () => {
    const beforeData = JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf-8'));
    const beforeCount = beforeData.orders ? beforeData.orders.length : 0;
    const create = await makeRequest('POST', '/api/orders', {
      name: '持久化测试', phone: '13700137002', productId: 'cabinet-1'
    });
    const afterData = JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf-8'));
    expect(afterData.orders.length).toBe(beforeCount + 1);
    const found = afterData.orders.find(o => o.id === create.body.data.order.id);
    expect(found).toBeDefined();
  });

  test('Empty POST body returns 400', async () => {
    const res = await makeRequest('POST', '/api/orders', {});
    expect(res.status).toBe(400);
  });

  test('Invalid JSON returns 400', async () => {
    const res = await new Promise((resolve, reject) => {
      const req = http.request({
        method: 'POST',
        hostname: '127.0.0.1',
        port: 3000,
        path: '/api/orders',
        headers: { 'Content-Type': 'application/json' }
      }, (response) => {
        let data = '';
        response.on('data', chunk => data += chunk);
        response.on('end', () => resolve({ status: response.statusCode, body: data }));
      });
      req.on('error', reject);
      req.write('{invalid');
      req.end();
    });
    expect(res.status).toBe(400);
  });

  test('Phone accepts 13359140982 (store phone)', async () => {
    const res = await makeRequest('POST', '/api/orders', {
      name: '店主自测', phone: '13359140982', productId: 'sofa-1'
    });
    expect(res.status).toBe(200);
    expect(res.body.data.order.phone).toBe('13359140982');
  });
});

test.describe('TryOn (AI composition) API', () => {
  test('POST /api/tryon returns simulated composition', async () => {
    const res = await makeRequest('POST', '/api/tryon', {
      productId: 'sofa-1',
      roomPhoto: 'data:image/jpeg;base64,fake'
    });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('compositionUrl');
    expect(typeof res.body.data.compositionUrl).toBe('string');
    expect(res.body.data).toHaveProperty('product');
    expect(res.body.data).toHaveProperty('message');
  });

  test('POST /api/tryon requires productId', async () => {
    const res = await makeRequest('POST', '/api/tryon', { roomPhoto: 'data:fake' });
    expect(res.status).toBe(400);
  });

  test('POST /api/tryon validates product exists', async () => {
    const res = await makeRequest('POST', '/api/tryon', {
      productId: 'unknown-product-xyz', roomPhoto: 'data:fake'
    });
    expect(res.status).toBe(404);
  });

  test('POST /api/tryon compositionUrl points to static image', async () => {
    const res = await makeRequest('POST', '/api/tryon', {
      productId: 'sofa-2', roomPhoto: 'data:fake'
    });
    expect(res.body.data.compositionUrl).toMatch(/^\/images\//);
  });
});

test.describe('Static assets', () => {
  test('GET /images/ returns directory or 404 cleanly (no server crash)', async () => {
    const res = await makeRequest('GET', '/images/');
    expect([200, 301, 403, 404]).toContain(res.status);
  });

  test('GET /images path is supported (static middleware)', async () => {
    const res = await makeRequest('GET', '/images/non-existent.jpg');
    expect([200, 404]).toContain(res.status);
  });
});