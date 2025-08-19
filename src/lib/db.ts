import { Pool } from 'pg';

const pool = new Pool({
    connectionString: 'postgresql://postgres.tlnjldrghozaigmyempy:HE2HSMJteiXyo2bw@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres',
});

export default pool;
