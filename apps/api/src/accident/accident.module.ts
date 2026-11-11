import { Module } from '@nestjs/common';
import { DailyReportsModule } from '../daily-reports/daily-reports.module';
import { AlertsController } from '../alerts/alerts.controller';
import { AlertsService } from '../alerts/alerts.service';
import { ControlRoomController } from '../control-room/control-room.controller';
import { ControlRoomService } from '../control-room/control-room.service';
import { DeskController } from '../desk/desk.controller';
import { DeskService } from '../desk/desk.service';
import { WorkshopController } from '../workshop/workshop.controller';
import { WorkshopService } from '../workshop/workshop.service';
import { ReferenceDataController } from '../reference-data/reference-data.controller';
import { ReferenceDataService } from '../reference-data/reference-data.service';
import { AssessmentsController } from '../assessments/assessments.controller';
import { AssessmentsService } from '../assessments/assessments.service';
import { BlockersService } from '../blockers/blockers.service';
import { CasesService } from '../cases/cases.service';
import { CompletionController } from '../completion/completion.controller';
import { CompletionService } from '../completion/completion.service';
import { DashboardService } from '../dashboard/dashboard.service';
import { FinanceController } from '../finance/finance.controller';
import { FinanceService } from '../finance/finance.service';
import { PartsOperationsController } from '../parts/parts-operations.controller';
import { PartsOperationsService } from '../parts/parts-operations.service';
import { PartsController } from '../parts/parts.controller';
import { PartsWorkbenchService } from '../parts/parts-workbench.service';
import { PartsService } from '../parts/parts.service';
import { DiscrepanciesController } from '../discrepancies/discrepancies.controller';
import { DiscrepanciesService } from '../discrepancies/discrepancies.service';
import { ReportsController } from '../reports/reports.controller';
import { ReportsService } from '../reports/reports.service';
import { TasksService } from '../tasks/tasks.service';
import { VehicleImportController } from '../vehicle-import/vehicle-import.controller';
import { VehicleImportService } from '../vehicle-import/vehicle-import.service';
import {
  BlockersController,
  CasesController,
  DashboardController,
  TasksController,
} from './accident.controllers';

/** Phase-1 module: accident repair cases, assessments, parts, finance gate, repair activities, blockers, QC and delivery, dashboard. */
@Module({
  imports: [DailyReportsModule],
  controllers: [
    AlertsController,
    DeskController,
    ControlRoomController,
    WorkshopController,
    ReferenceDataController,
    CasesController,
    TasksController,
    BlockersController,
    DashboardController,
    AssessmentsController,
    PartsController,
    PartsOperationsController,
    FinanceController,
    CompletionController,
    VehicleImportController,
    ReportsController,
    DiscrepanciesController,
  ],
  providers: [
    AlertsService,
    DeskService,
    ControlRoomService,
    WorkshopService,
    ReferenceDataService,
    CasesService,
    TasksService,
    BlockersService,
    DashboardService,
    AssessmentsService,
    PartsService,
    PartsWorkbenchService,
    PartsOperationsService,
    FinanceService,
    CompletionService,
    VehicleImportService,
    ReportsService,
    DiscrepanciesService,
  ],
  exports: [CasesService, TasksService, BlockersService, AssessmentsService, PartsService, FinanceService, CompletionService],
})
export class AccidentModule {}
