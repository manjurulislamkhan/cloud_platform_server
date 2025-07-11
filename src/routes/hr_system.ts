
import { MongoClient, Db, Collection, InsertOneResult, UpdateResult, MongoError } from 'mongodb';
import fetch from 'node-fetch';
import { getDb } from '../db';

// Configuration interfaces
interface WorkdayConfig {
  baseUrl: string;
  username: string;
  password: string;
  tenant: string;
}

interface BambooHRConfig {
  subdomain: string;
  apiKey: string;
  clientId?: string;
  clientSecret?: string;
  accessToken?: string;
}

interface SuccessFactorsConfig {
  baseUrl: string;
  companyId: string;
  username: string;
  password: string;
}

interface MongoConfig {
  uri: string;
  database: string;
}

// Employee data interfaces
interface Employee {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  department?: string;
  position?: string;
  hireDate?: Date;
  status: 'active' | 'inactive' | 'terminated';
  source: 'workday' | 'bamboohr' | 'successfactors';
  lastSync: Date;
  rawData: any;
}

interface SyncResult {
  success: boolean;
  recordsProcessed: number;
  errors: string[];
  lastSync: Date;
}

class HRSystemsIntegration {
  private db: Db = getDb();
  private employeesCollection!: Collection<Employee>;
  private syncLogsCollection!: Collection;

  constructor(
    private mongoClient: MongoClient,
    private mongoConfig: MongoConfig,
    private workdayConfig: WorkdayConfig,
    private bambooHRConfig: BambooHRConfig,
    private successFactorsConfig: SuccessFactorsConfig
  ) {}

  async initialize(): Promise<void> {
    await this.mongoClient.connect();
    this.db = this.mongoClient.db(this.mongoConfig.database);
    this.employeesCollection = this.db.collection<Employee>('employees');
    this.syncLogsCollection = this.db.collection('sync_logs');

    // Create indexes for better performance
    await this.employeesCollection.createIndex({ id: 1, source: 1 }, { unique: true });
    await this.employeesCollection.createIndex({ email: 1 });
    await this.employeesCollection.createIndex({ lastSync: 1 });
  }

  // Workday Integration
  private async getWorkdayAuthToken(): Promise<string> {
    const credentials = Buffer.from(`${this.workdayConfig.username}:${this.workdayConfig.password}`).toString('base64');
    
    const response = await fetch(`${this.workdayConfig.baseUrl}/ccx/oauth2/${this.workdayConfig.tenant}/token`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: 'grant_type=client_credentials'
    });

    if (!response.ok) {
      throw new Error(`Workday auth failed: ${response.statusText}`);
    }

    const data = await response.json() as any;
    return data.access_token;
  }

  async syncWorkdayEmployees(): Promise<SyncResult> {
    const result: SyncResult = {
      success: false,
      recordsProcessed: 0,
      errors: [],
      lastSync: new Date()
    };

    try {
      const token = await this.getWorkdayAuthToken();
      
      // Use Workday REST API to get workers
      const response = await fetch(`${this.workdayConfig.baseUrl}/ccx/api/privacy/v1/${this.workdayConfig.tenant}/workers`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`Workday API error: ${response.statusText}`);
      }

      const data = await response.json() as any;
      const workers = data.data || [];

      for (const worker of workers) {
        try {
          const employee: Employee = {
            id: worker.id,
            firstName: worker.personalData?.nameData?.legalNameData?.nameDetailData?.firstName || '',
            lastName: worker.personalData?.nameData?.legalNameData?.nameDetailData?.lastName || '',
            email: worker.personalData?.contactData?.emailAddressData?.[0]?.emailAddress || '',
            department: worker.employmentData?.positionData?.organizationData?.[0]?.organizationName,
            position: worker.employmentData?.positionData?.businessTitle,
            hireDate: worker.employmentData?.workerJobData?.positionData?.startDate ? new Date(worker.employmentData.workerJobData.positionData.startDate) : undefined,
            status: worker.employmentData?.workerStatus?.activeStatusFlag ? 'active' : 'inactive',
            source: 'workday',
            lastSync: result.lastSync,
            rawData: worker
          };

          await this.employeesCollection.replaceOne(
            { id: employee.id, source: 'workday' },
            employee,
            { upsert: true }
          );
          
          result.recordsProcessed++;
        } catch (error: any) {
          result.errors.push(`Error processing worker ${worker.id}: ${error.message}`);
        }
      }

      result.success = result.errors.length === 0;
    } catch (error: any) {
      result.errors.push(`Workday sync failed: ${error.message}`);
    }

    await this.logSync('workday', result);
    return result;
  }

  // BambooHR Integration
  private async getBambooHRHeaders(): Promise<Record<string, string>> {
    if (this.bambooHRConfig.accessToken) {
      return {
        'Authorization': `Bearer ${this.bambooHRConfig.accessToken}`,
        'Accept': 'application/json'
      };
    } else {
      // Use API key authentication
      const credentials = Buffer.from(`${this.bambooHRConfig.apiKey}:x`).toString('base64');
      return {
        'Authorization': `Basic ${credentials}`,
        'Accept': 'application/json'
      };
    }
  }

  async syncBambooHREmployees(): Promise<SyncResult> {
    const result: SyncResult = {
      success: false,
      recordsProcessed: 0,
      errors: [],
      lastSync: new Date()
    };

    try {
      const headers = await this.getBambooHRHeaders();
      
      // Get employee directory
      const response = await fetch(`https://api.bamboohr.com/api/gateway.php/${this.bambooHRConfig.subdomain}/v1/employees/directory`, {
        headers
      });

      if (!response.ok) {
        throw new Error(`BambooHR API error: ${response.statusText}`);
      }

      const data = await response.json() as any;
      const employees = data.employees || [];

      for (const emp of employees) {
        try {
          // Get detailed employee information
          const detailResponse = await fetch(`https://api.bamboohr.com/api/gateway.php/${this.bambooHRConfig.subdomain}/v1/employees/${emp.id}?fields=firstName,lastName,workEmail,department,jobTitle,hireDate,employmentStatus`, {
            headers
          });

          if (!detailResponse.ok) continue;

          const empDetail = await detailResponse.json() as any;
          
          const employee: Employee = {
            id: emp.id.toString(),
            firstName: empDetail.firstName || emp.firstName || '',
            lastName: empDetail.lastName || emp.lastName || '',
            email: empDetail.workEmail || emp.workEmail || '',
            department: empDetail.department,
            position: empDetail.jobTitle,
            hireDate: empDetail.hireDate ? new Date(empDetail.hireDate) : undefined,
            status: empDetail.employmentStatus === 'Active' ? 'active' : 'inactive',
            source: 'bamboohr',
            lastSync: result.lastSync,
            rawData: empDetail
          };

          await this.employeesCollection.replaceOne(
            { id: employee.id, source: 'bamboohr' },
            employee,
            { upsert: true }
          );
          
          result.recordsProcessed++;
        } catch (error: any) {
          result.errors.push(`Error processing employee ${emp.id}: ${error.message}`);
        }
      }

      result.success = result.errors.length === 0;
    } catch (error: any) {
      result.errors.push(`BambooHR sync failed: ${error.message}`);
    }

    await this.logSync('bamboohr', result);
    return result;
  }

  // SAP SuccessFactors Integration
  private async getSuccessFactorsHeaders(): Promise<Record<string, string>> {
    const credentials = Buffer.from(`${this.successFactorsConfig.username}:${this.successFactorsConfig.password}`).toString('base64');
    return {
      'Authorization': `Basic ${credentials}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    };
  }

  async syncSuccessFactorsEmployees(): Promise<SyncResult> {
    const result: SyncResult = {
      success: false,
      recordsProcessed: 0,
      errors: [],
      lastSync: new Date()
    };

    try {
      const headers = await this.getSuccessFactorsHeaders();
      
      // Use OData API to get user information
      const response = await fetch(`${this.successFactorsConfig.baseUrl}/odata/v2/User?$format=json&$select=userId,firstName,lastName,email,department,title,startDate,status`, {
        headers
      });

      if (!response.ok) {
        throw new Error(`SuccessFactors API error: ${response.statusText}`);
      }

      const data = await response.json() as any;
      const users = data.d?.results || [];

      for (const user of users) {
        try {
          const employee: Employee = {
            id: user.userId,
            firstName: user.firstName || '',
            lastName: user.lastName || '',
            email: user.email || '',
            department: user.department,
            position: user.title,
            hireDate: user.startDate ? new Date(user.startDate) : undefined,
            status: user.status === 'A' ? 'active' : 'inactive',
            source: 'successfactors',
            lastSync: result.lastSync,
            rawData: user
          };

          await this.employeesCollection.replaceOne(
            { id: employee.id, source: 'successfactors' },
            employee,
            { upsert: true }
          );
          
          result.recordsProcessed++;
        } catch (error: any) {
          result.errors.push(`Error processing user ${user.userId}: ${error.message}`);
        }
      }

      result.success = result.errors.length === 0;
    } catch (error : any) {
      result.errors.push(`SuccessFactors sync failed: ${error.message}`);
    }

    await this.logSync('successfactors', result);
    return result;
  }

  // Utility methods
  private async logSync(system: string, result: SyncResult): Promise<void> {
    await this.syncLogsCollection.insertOne({
      system,
      timestamp: result.lastSync,
      success: result.success,
      recordsProcessed: result.recordsProcessed,
      errors: result.errors
    });
  }

  async syncAllSystems(): Promise<Record<string, SyncResult>> {
    const results = {
      workday: await this.syncWorkdayEmployees(),
      bamboohr: await this.syncBambooHREmployees(),
      successfactors: await this.syncSuccessFactorsEmployees()
    };

    console.log('Sync completed:', results);
    return results;
  }

  async getEmployeeById(id: string, source?: string): Promise<Employee | null> {
    const filter: any = { id };
    if (source) filter.source = source;
    
    return await this.employeesCollection.findOne(filter);
  }

  async getEmployeesByDepartment(department: string): Promise<Employee[]> {
    return await this.employeesCollection.find({ department }).toArray();
  }

  async getActiveEmployees(): Promise<Employee[]> {
    return await this.employeesCollection.find({ status: 'active' }).toArray();
  }

  async getEmployeesSyncedAfter(date: Date): Promise<Employee[]> {
    return await this.employeesCollection.find({ lastSync: { $gte: date } }).toArray();
  }

  async getSyncLogs(system?: string, limit = 50): Promise<any[]> {
    const filter = system ? { system } : {};
    return await this.syncLogsCollection
      .find(filter)
      .sort({ timestamp: -1 })
      .limit(limit)
      .toArray();
  }

  async close(): Promise<void> {
    await this.mongoClient.close();
  }
}

// Usage Example
async function main() {
  const mongoConfig: MongoConfig = {
    uri: process.env.MONGODB_URI || 'mongodb://localhost:27017',
    database: process.env.MONGODB_DATABASE || 'hr_systems'
  };

  const workdayConfig: WorkdayConfig = {
    baseUrl: process.env.WORKDAY_BASE_URL || 'https://services1.myworkday.com',
    username: process.env.WORKDAY_USERNAME || '',
    password: process.env.WORKDAY_PASSWORD || '',
    tenant: process.env.WORKDAY_TENANT || ''
  };

  const bambooHRConfig: BambooHRConfig = {
    subdomain: process.env.BAMBOOHR_SUBDOMAIN || '',
    apiKey: process.env.BAMBOOHR_API_KEY || '',
    // OAuth 2.0 credentials (optional)
    clientId: process.env.BAMBOOHR_CLIENT_ID,
    clientSecret: process.env.BAMBOOHR_CLIENT_SECRET,
    accessToken: process.env.BAMBOOHR_ACCESS_TOKEN
  };

  const successFactorsConfig: SuccessFactorsConfig = {
    baseUrl: process.env.SUCCESSFACTORS_BASE_URL || '',
    companyId: process.env.SUCCESSFACTORS_COMPANY_ID || '',
    username: process.env.SUCCESSFACTORS_USERNAME || '',
    password: process.env.SUCCESSFACTORS_PASSWORD || ''
  };

  const mongoClient = new MongoClient(mongoConfig.uri);
  const integration = new HRSystemsIntegration(
    mongoClient,
    mongoConfig,
    workdayConfig,
    bambooHRConfig,
    successFactorsConfig
  );

  try {
    await integration.initialize();
    console.log('Integration initialized successfully');

    // Sync all systems
    const results = await integration.syncAllSystems();
    
    // Query examples
    const activeEmployees = await integration.getActiveEmployees();
    console.log(`Found ${activeEmployees.length} active employees`);

    const recentSyncs = await integration.getSyncLogs();
    console.log('Recent sync logs:', recentSyncs.slice(0, 3));

  } catch (error) {
    console.error('Integration error:', error);
  } finally {
    await integration.close();
  }
}

// Export for use as module
export {
  HRSystemsIntegration,
  WorkdayConfig,
  BambooHRConfig,
  SuccessFactorsConfig,
  MongoConfig,
  Employee,
  SyncResult
};

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}