// Definition matching Rust's LocalPackage for installed packages
export interface LocalPackage {
  name: string;
  version: string;
  repo_type: string;
}

// Definition matching Rust's RepositoryPackage for search entries
export interface Package {
  name: string;
  version: string;
  repo: string;
  description: string;
  is_installed: boolean;
  out_of_date?: string | null;
}

// Definition matching Rust's UpgradablePackage for pending system updates
export interface UpgradablePackage {
  name: string;
  current_version: string;
  new_version: string;
  repo_type: string;
}

// Definition matching Rust's TransactionLine emitted during live logging
export interface TransactionLine {
  transaction_id: string;
  stream: 'stdout' | 'stderr';
  content: string;
}

// Definition matching Rust's TransactionStatus emitted upon process completion
export interface TransactionStatus {
  transaction_id: string;
  exit_code: number;
  success: boolean;
}
