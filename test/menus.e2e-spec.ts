import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from './../src/app.module';
import { PrismaService } from '../src/shared/services/prisma.service';
import { TransformInterceptor } from '../src/common/interceptors/transform.interceptor';

describe('Menus (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: any;
  const seeded: any[] = [];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));

  // replicate setup from main.ts used in production
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  // register the global response transform interceptor so responses match production
  app.useGlobalInterceptors(new TransformInterceptor());
    await app.init();
    // Debug: print registered routes
    try {
      const serverInstance: any = app.getHttpAdapter().getInstance();
      const routes = serverInstance._router.stack
        .filter((r) => r.route)
        .map((r) => {
          const methods = Object.keys(r.route.methods).join(',').toUpperCase();
          return `${methods} ${r.route.path}`;
        });
      console.log('Registered routes:');
      routes.forEach((rt) => console.log(rt));
    } catch (err) {
      console.log('Could not list routes:', err.message);
    }
    server = app.getHttpServer();
    prisma = moduleFixture.get<PrismaService>(PrismaService);

    // Seed dummy menus
  const m1 = await (prisma as any).menu.create({ data: { Name: 'Seed Menu 1', location: 'loc1', imageUrl: null } });
  const m2 = await (prisma as any).menu.create({ data: { Name: 'Seed Menu 2', location: 'loc2', imageUrl: null } });
    seeded.push(m1, m2);
  }, 20000);

  afterAll(async () => {
    // Cleanup seeded data (ignore already-deleted records)
    for (const s of seeded) {
      try {
        await (prisma as any).menu.delete({ where: { id: s.id } });
      } catch (err) {
        // ignore not found or other delete errors during cleanup
      }
    }
    if (app && app.close) await app.close();
  });

  it('/menus (GET) should list menus', async () => {
    const res = await request(server).get('/api/v1/menus').expect(200);
    // response is wrapped by TransformInterceptor -> { data: [...] }
    expect(Array.isArray(res.body.data)).toBe(true);
    // ensure our seeded menus are present (Prisma field is `Name`)
    const names = res.body.data.map((r) => r.Name);
    expect(names).toEqual(expect.arrayContaining(['Seed Menu 1', 'Seed Menu 2']));
  });

  it('/menus/:id (GET) should return a single menu', async () => {
    const id = seeded[0].id;
    const res = await request(server).get(`/api/v1/menus/${id}`).expect(200);
    expect(res.body).toBeDefined();
    expect(res.body.data.id).toBe(id);
  });

  it('/menus/:id (PATCH) should update a menu', async () => {
    const id = seeded[0].id;
    const res = await request(server)
      .patch(`/api/v1/menus/${id}`)
      .send({ name: 'Updated Seed Menu 1' })
      .expect(200);
    expect(res.body).toBeDefined();
    // Prisma returns Name field; wrapped response -> data
    expect(res.body.data.Name).toBe('Updated Seed Menu 1');
  });

  it('/menus/:id (DELETE) should remove a menu', async () => {
    const id = seeded[1].id;
    await request(server).delete(`/api/v1/menus/${id}`).expect(200);

    // confirm deletion
    await request(server).get(`/api/v1/menus/${id}`).expect(404);
  });

  describe('Validation scenarios for POST /api/v1/menus', () => {
    it('should return 400 when required name missing', async () => {
      await request(server).post('/api/v1/menus').send({ location: 'x' }).expect(400);
    });

    it('should return 400 when unknown extra fields are present', async () => {
      await request(server)
        .post('/api/v1/menus')
        .send({ name: 'Valid Name', extraField: 'not-allowed' })
        .expect(400);
    });

    it('should return 400 for invalid name type', async () => {
      await request(server).post('/api/v1/menus').send({ name: 123 as any }).expect(400);
    });

    it('should create a menu successfully with valid payload', async () => {
      const res = await request(server)
        .post('/api/v1/menus')
        .send({ name: 'Created via e2e', location: 'test-loc' })
        .expect(201);

      // cleanup newly created
      const created = res.body.data;
      await (prisma as any).menu.delete({ where: { id: created.id } });
    });
  });
});
