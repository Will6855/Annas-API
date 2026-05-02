import { DataSource, DataSourceOptions } from 'typeorm';
import { User } from './entities/User';
import { config } from './config';
import { logger } from './logger';
import bcrypt from 'bcrypt';

const isProd = config.server.env === 'production';
const dbConfig: DataSourceOptions = isProd
  ? {
      type: 'postgres',
      url: config.db.url,
      synchronize: false,
      logging: false,
      entities: [User],
    }
  : {
      type: 'sqlite',
      database: 'dev.sqlite',
      synchronize: true,
      logging: false,
      entities: [User],
    };

export const AppDataSource = new DataSource(dbConfig);

export const initializeDatabase = async () => {
  try {
    await AppDataSource.initialize();
    logger.info(`🗄️  Database initialized (${config.server.env === 'production' ? 'postgres' : 'sqlite'})`);

    // Seed admin user if it doesn't exist
    const userRepository = AppDataSource.getRepository(User);
    const adminExists = await userRepository.findOneBy({ username: 'admin' });
    
    if (!adminExists) {
      const hashedPassword = await bcrypt.hash('admin', 10);
      const admin = userRepository.create({
        username: 'admin',
        password: hashedPassword,
        role: 'admin',
      });
      await userRepository.save(admin);
      logger.info('👤 Default admin user created (username: admin, password: admin). Please change password in production!');
    }
  } catch (error) {
    logger.error('Database initialization failed:', error);
    process.exit(1);
  }
};
