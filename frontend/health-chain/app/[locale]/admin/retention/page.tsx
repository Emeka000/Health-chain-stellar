"use client";
import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertTriangle, Shield, Database, Clock } from "lucide-react";

interface SensitiveField {
  entityType: string;
  fieldName: string;
  fieldType: string;
  dataCategory: string;
  description: string;
}

interface RetentionPolicy {
  id: string;
  dataCategory: string;
  legalBasis: string;
  retentionPeriodDays: number;
  retentionAction: string;
  isActive: boolean;
  description: string;
}

interface DataRedaction {
  id: string;
  entityType: string;
  entityId: string;
  dataCategory: string;
  fieldName: string;
  fieldType: string;
  status: string;
  executedAt?: string;
  redactionReason?: string;
}

export default function RetentionManagementPage() {
  const [sensitiveFields, setSensitiveFields] = useState<SensitiveField[]>([]);
  const [policies, setPolicies] = useState<RetentionPolicy[]>([]);
  const [redactions, setRedactions] = useState<DataRedaction[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [triggerResult, setTriggerResult] = useState<any>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [fieldsRes, policiesRes, redactionsRes] = await Promise.all([
        fetch('/api/retention/sensitive-fields'),
        fetch('/api/retention/policies'),
        fetch('/api/retention/redactions'),
      ]);

      if (fieldsRes.ok) {
        const fields = await fieldsRes.json();
        setSensitiveFields(fields);
      }

      if (policiesRes.ok) {
        const policiesData = await policiesRes.json();
        setPolicies(policiesData);
      }

      if (redactionsRes.ok) {
        const redactionsData = await redactionsRes.json();
        setRedactions(redactionsData);
      }
    } catch (error) {
      console.error('Failed to load retention data:', error);
    }
  };

  const triggerRetention = async () => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/retention/trigger', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (response.ok) {
        const result = await response.json();
        setTriggerResult(result);
        // Reload data to see changes
        await loadData();
      }
    } catch (error) {
      console.error('Failed to trigger retention:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const getCategoryColor = (category: string) => {
    const colors: Record<string, string> = {
      donor_data: 'bg-blue-100 text-blue-800',
      rider_data: 'bg-green-100 text-green-800',
      organization_data: 'bg-purple-100 text-purple-800',
      delivery_evidence: 'bg-orange-100 text-orange-800',
      location_history: 'bg-red-100 text-red-800',
      medical_records: 'bg-pink-100 text-pink-800',
    };
    return colors[category] || 'bg-gray-100 text-gray-800';
  };

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      pending: 'bg-yellow-100 text-yellow-800',
      in_progress: 'bg-blue-100 text-blue-800',
      completed: 'bg-green-100 text-green-800',
      failed: 'bg-red-100 text-red-800',
    };
    return colors[status] || 'bg-gray-100 text-gray-800';
  };

  return (
    <div className="p-6 lg:p-10 space-y-6 bg-gray-50 min-h-screen">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Data Privacy & Retention</h1>
          <p className="text-gray-600 mt-2">
            Manage sensitive data classification, retention policies, and redaction audits
          </p>
        </div>

        <Button
          onClick={triggerRetention}
          disabled={isLoading}
          className="bg-red-600 hover:bg-red-700 text-white"
        >
          {isLoading ? 'Processing...' : 'Run Retention Job'}
        </Button>
      </div>

      {triggerResult && (
        <Card className="border-green-200 bg-green-50">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-green-800">
              <Shield className="w-5 h-5" />
              <span className="font-semibold">Retention Job Completed</span>
            </div>
            <div className="mt-2 text-sm text-green-700">
              Sessions deleted: {triggerResult.sessionsDeleted} |
              Logs deleted: {triggerResult.logsDeleted} |
              Redactions processed: {triggerResult.redactionsProcessed} |
              Redactions failed: {triggerResult.redactionsFailed}
            </div>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="fields" className="space-y-6">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="fields">Sensitive Fields</TabsTrigger>
          <TabsTrigger value="policies">Retention Policies</TabsTrigger>
          <TabsTrigger value="audit">Redaction Audit</TabsTrigger>
        </TabsList>

        <TabsContent value="fields" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="w-5 h-5" />
                Classified Sensitive Fields
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4">
                {sensitiveFields.map((field, index) => (
                  <div key={index} className="flex items-center justify-between p-4 border rounded-lg">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge className={getCategoryColor(field.dataCategory)}>
                          {field.dataCategory.replace('_', ' ')}
                        </Badge>
                        <span className="font-medium">{field.entityType}.{field.fieldName}</span>
                      </div>
                      <p className="text-sm text-gray-600">{field.description}</p>
                    </div>
                    <Badge variant="outline">{field.fieldType}</Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="policies" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="w-5 h-5" />
                Retention Policies
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4">
                {policies.map((policy) => (
                  <div key={policy.id} className="flex items-center justify-between p-4 border rounded-lg">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge className={getCategoryColor(policy.dataCategory)}>
                          {policy.dataCategory.replace('_', ' ')}
                        </Badge>
                        <span className="font-medium">{policy.retentionPeriodDays} days</span>
                      </div>
                      <p className="text-sm text-gray-600">{policy.description}</p>
                      <p className="text-xs text-gray-500 mt-1">
                        Legal basis: {policy.legalBasis} | Action: {policy.retentionAction}
                      </p>
                    </div>
                    <Badge variant={policy.isActive ? "default" : "secondary"}>
                      {policy.isActive ? 'Active' : 'Inactive'}
                    </Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="audit" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Database className="w-5 h-5" />
                Data Redaction Audit Log
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {redactions.slice(0, 50).map((redaction) => (
                  <div key={redaction.id} className="flex items-center justify-between p-4 border rounded-lg">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge className={getCategoryColor(redaction.dataCategory)}>
                          {redaction.dataCategory.replace('_', ' ')}
                        </Badge>
                        <Badge className={getStatusColor(redaction.status)}>
                          {redaction.status}
                        </Badge>
                      </div>
                      <p className="font-medium">
                        {redaction.entityType}.{redaction.fieldName} ({redaction.entityId})
                      </p>
                      {redaction.redactionReason && (
                        <p className="text-sm text-gray-600">{redaction.redactionReason}</p>
                      )}
                      {redaction.executedAt && (
                        <p className="text-xs text-gray-500">
                          Executed: {new Date(redaction.executedAt).toLocaleString()}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
                {redactions.length === 0 && (
                  <div className="text-center py-8 text-gray-500">
                    No redactions have been performed yet.
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}