import { NestExpressApplication } from '@nestjs/platform-express';
import { engine } from 'express-handlebars';
import * as path from 'path';

export function setupHandlebars(app: NestExpressApplication) {
  const viewsPath = path.join(process.cwd(), 'views');
  const partialsPath = path.join(viewsPath, 'partials');
  const layoutsPath = path.join(viewsPath, 'layouts');
  const publicPath = path.join(process.cwd(), 'public');

  app.engine(
    'hbs',
    engine({
      extname: '.hbs',
      layoutsDir: layoutsPath,
      partialsDir: partialsPath,
      defaultLayout: false,
    }),
  );

  app.setBaseViewsDir(viewsPath);
  app.setViewEngine('hbs');
  app.useStaticAssets(publicPath);
}
