import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ReadinessDependencyEntity } from '../entities/readiness-dependency.entity';
import { ReadinessItemKey, ReadinessItemStatus } from '../enums/readiness.enum';
import { ReadinessItemEntity } from '../entities/readiness-item.entity';

export interface BlockingReason {
  itemKey: ReadinessItemKey;
  reason: string;
  prerequisiteKey: ReadinessItemKey;
}

@Injectable()
export class ReadinessGraphService implements OnModuleInit {
  private readonly logger = new Logger(ReadinessGraphService.name);
  private adjList: Map<ReadinessItemKey, Array<{ key: ReadinessItemKey; condition?: string }>> = new Map();

  constructor(
    @InjectRepository(ReadinessDependencyEntity)
    private readonly dependencyRepo: Repository<ReadinessDependencyEntity>,
  ) {}

  async onModuleInit() {
    await this.refreshGraph();
  }

  /**
   * Loads dependencies from DB and validates that they form an Acyclic Graph (DAG).
   * Throws if a cycle is detected.
   */
  async refreshGraph() {
    const dependencies = await this.dependencyRepo.find();
    const newAdjList = new Map<ReadinessItemKey, Array<{ key: ReadinessItemKey; condition?: string }>>();

    for (const dep of dependencies) {
      const list = newAdjList.get(dep.parentItemKey) || [];
      list.push({
        key: dep.dependsOnItemKey,
        condition: dep.conditionExpression || undefined,
      });
      newAdjList.set(dep.parentItemKey, list);
    }

    this.validateAcyclic(newAdjList);
    this.adjList = newAdjList;
    this.logger.log('Readiness dependency graph refreshed and validated.');
  }

  /**
   * Validates a list of potential dependencies for cycles without updating the active graph.
   * Useful for configuration-time validation.
   */
  validateProposedDependencies(
    proposed: Array<{
      parentItemKey: ReadinessItemKey;
      dependsOnItemKey: ReadinessItemKey;
    }>,
  ) {
    const testAdjList = new Map<ReadinessItemKey, Array<{ key: ReadinessItemKey }>>();
    for (const dep of proposed) {
      const list = testAdjList.get(dep.parentItemKey) || [];
      list.push({ key: dep.dependsOnItemKey });
      testAdjList.set(dep.parentItemKey, list);
    }
    this.validateAcyclic(testAdjList as any);
  }

  /**
   * Checks if an item is currently blocked by its prerequisites.
   * Returns a list of blocking reasons if any.
   */
  getBlockers(
    itemKey: ReadinessItemKey,
    allItems: ReadinessItemEntity[],
    context?: Record<string, any>,
  ): BlockingReason[] {
    const prerequisites = this.adjList.get(itemKey) || [];
    const blockers: BlockingReason[] = [];

    for (const prereq of prerequisites) {
      // Evaluate condition if present
      if (prereq.condition && !this.evaluateCondition(prereq.condition, context)) {
        continue; // Skip dependency if condition is not met
      }

      const prereqItem = allItems.find((i) => i.itemKey === prereq.key);

      // If prerequisite item is missing or not done, it's a blocker
      if (!prereqItem || prereqItem.status === ReadinessItemStatus.PENDING) {
        blockers.push({
          itemKey,
          prerequisiteKey: prereq.key,
          reason: `Prerequisite '${prereq.key}' is not yet completed or waived.`,
        });
      }
    }

    return blockers;
  }

  /**
   * Simple condition evaluator.
   * Supports basic equality: "key == 'value'"
   */
  private evaluateCondition(condition: string, context?: Record<string, any>): boolean {
    if (!context) return true; // default to true if no context
    
    const match = condition.match(/^(\w+)\s*==\s*'([^']*)'$/);
    if (match) {
      const [_, key, value] = match;
      return context[key] === value;
    }
    
    return true; // fallback for unsupported expressions
  }

  /**
   * Depth-First Search for cycle detection
   */
  private validateAcyclic(adjList: Map<ReadinessItemKey, Array<{ key: ReadinessItemKey }>>) {
    const visited = new Set<ReadinessItemKey>();
    const recStack = new Set<ReadinessItemKey>();

    for (const key of adjList.keys()) {
      if (this.hasCycle(key, adjList, visited, recStack)) {
        throw new Error(`Cycle detected in readiness dependencies starting at ${key}`);
      }
    }
  }

  private hasCycle(
    u: ReadinessItemKey,
    adjList: Map<ReadinessItemKey, Array<{ key: ReadinessItemKey }>>,
    visited: Set<ReadinessItemKey>,
    recStack: Set<ReadinessItemKey>,
  ): boolean {
    if (recStack.has(u)) return true;
    if (visited.has(u)) return false;

    visited.add(u);
    recStack.add(u);

    const neighbors = adjList.get(u) || [];
    for (const v of neighbors) {
      if (this.hasCycle(v.key, adjList, visited, recStack)) return true;
    }

    recStack.delete(u);
    return false;
  }

  /** Returns all prerequisites for a given item */
  getPrerequisites(itemKey: ReadinessItemKey): ReadinessItemKey[] {
    return (this.adjList.get(itemKey) || []).map((p) => p.key);
  }
}
