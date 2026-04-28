import { Body, Controller, Delete, Get, Param, Post, Put, Request } from '@nestjs/common';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';

import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { Permission } from '../auth/enums/permission.enum';
import { BloodType } from '../blood-units/enums/blood-type.enum';
import { User } from '../auth/decorators/user.decorator';

import { SurgeSimulationRequestDto, CreateScenarioDto, CompareScenarioDto } from './dto/surge-simulation.dto';
import { SurgeSimulationService, SurgeSimulationResult, SurgeEvaluationResult } from './surge-simulation.service';
import { SurgeRuleEntity } from './entities/surge-rule.entity';

@Controller('surge-simulation')
export class SurgeSimulationController {
  constructor(private readonly surgeSimulationService: SurgeSimulationService) {}

  @Post()
  @ApiOperation({ summary: 'Simulate a demand surge against current stock and modeled rider capacity' })
  @ApiResponse({ status: 200, description: 'Simulation result' })
  async run(@Body() dto: SurgeSimulationRequestDto): Promise<SurgeSimulationResult> {
    return this.surgeSimulationService.simulate(dto);
  }

  @RequirePermissions(Permission.ADMIN_ACCESS)
  @Post('evaluate')
  @ApiOperation({ summary: 'Evaluate surge rules against live inventory and activate/deactivate accordingly' })
  async evaluate(): Promise<SurgeEvaluationResult> {
    return this.surgeSimulationService.evaluateSurge();
  }

  @RequirePermissions(Permission.ADMIN_ACCESS)
  @Get('rules')
  @ApiOperation({ summary: 'List all surge rules' })
  async listRules(): Promise<SurgeRuleEntity[]> {
    return this.surgeSimulationService.findAllRules();
  }

  @RequirePermissions(Permission.ADMIN_ACCESS)
  @Put('rules/:bloodType')
  @ApiOperation({ summary: 'Create or update a surge rule for a blood type' })
  async upsertRule(
    @Param('bloodType') bloodType: BloodType,
    @Body() body: { threshold: number; multiplier: number; maxMultiplier?: number },
  ): Promise<SurgeRuleEntity> {
    return this.surgeSimulationService.upsertRule({ bloodType, ...body });
  }

  @RequirePermissions(Permission.ADMIN_ACCESS)
  @Delete('rules/:id')
  @ApiOperation({ summary: 'Delete a surge rule' })
  async deleteRule(@Param('id') id: string): Promise<void> {
    return this.surgeSimulationService.deleteRule(id);
  }

  // ── Scenario management ──────────────────────────────────────────────────

  @Post('scenarios')
  @RequirePermissions(Permission.ADMIN_ACCESS)
  @ApiOperation({ summary: 'Create a stored scenario for deterministic replay' })
  async createScenario(@Body() dto: CreateScenarioDto, @User('id') userId: string) {
    return this.surgeSimulationService.createScenario(dto, userId ?? 'system');
  }

  @Get('scenarios')
  @RequirePermissions(Permission.ADMIN_ACCESS)
  @ApiOperation({ summary: 'List all stored scenarios' })
  async listScenarios() {
    return this.surgeSimulationService.listScenarios();
  }

  @Get('scenarios/:id')
  @RequirePermissions(Permission.ADMIN_ACCESS)
  @ApiOperation({ summary: 'Get a stored scenario' })
  async getScenario(@Param('id') id: string) {
    return this.surgeSimulationService.getScenario(id);
  }

  /** Replay a scenario deterministically using its stored seed */
  @Post('scenarios/:id/replay')
  @RequirePermissions(Permission.ADMIN_ACCESS)
  @ApiOperation({ summary: 'Replay a scenario deterministically from its stored seed' })
  async replayScenario(@Param('id') id: string): Promise<SurgeSimulationResult> {
    return this.surgeSimulationService.replayScenario(id);
  }

  /** Compare multiple scenarios and identify bottlenecks */
  @Post('scenarios/compare')
  @RequirePermissions(Permission.ADMIN_ACCESS)
  @ApiOperation({ summary: 'Compare scenarios and identify bottlenecks with policy tradeoffs' })
  async compareScenarios(@Body() dto: CompareScenarioDto) {
    return this.surgeSimulationService.compareScenarios(dto.scenarioIds);
  }
}
