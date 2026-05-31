import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity()
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ unique: true })
  username!: string;

  @Column()
  password!: string;

  @Column({ default: 'user' })
  role!: string;

  @Column({ default: -1 })
  rateLimitBookDetail!: number;

  @Column({ default: -1 })
  rateLimitBookDownload!: number;

  @Column({ default: -1 })
  rateLimitBookRelated!: number;

  @Column({ default: -1 })
  rateLimitSearch!: number;

  @CreateDateColumn()
  createdAt!: Date;
}
