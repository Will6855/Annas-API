import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn, Index } from 'typeorm';
import { User } from './User';

@Entity()
@Index(['userId', 'createdAt']) // For efficient queries per user
export class ApiUsage {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: User;

  @Column()
  endpoint!: string;

  @Column()
  method!: string;

  @Column({ nullable: true })
  ip!: string;

  @CreateDateColumn()
  createdAt!: Date;
}
