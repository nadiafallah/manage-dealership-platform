import { Module } from '@nestjs/common';
import { SpecialAidController } from './special-aid.controller';
import { SpecialAidService } from './special-aid.service';
import { SpecialAidScheduler } from './special-aid.scheduler';
import { SpecialAidRecordsService } from './special-aid-records.service';
import { CARD_EXTRACTOR, NoCardExtractor } from './card-extractor';
import { ReportCenterController } from './report-center.controller';
import { ReportCenterService } from './report-center.service';

/** «پیگیری امداد ویژه»: dossiers per VIN, contacts, part states, cards, appointments and supply follow-up (spec section 25). */
@Module({
  controllers: [SpecialAidController, ReportCenterController],
  // No OCR provider by default (owner decision E); a future provider replaces NoCardExtractor here.
  providers: [SpecialAidService, SpecialAidRecordsService, SpecialAidScheduler, ReportCenterService, { provide: CARD_EXTRACTOR, useClass: NoCardExtractor }],
  exports: [SpecialAidService, SpecialAidRecordsService],
})
export class SpecialAidModule {}
