import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('transparency_publications')
export class TransparencyPublicationEntity {
  @PrimaryColumn({ type: 'date' })
  period: string;

  @Column({ type: 'jsonb' })
  artifact: Record<string, unknown>;
}