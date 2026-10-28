terraform {
  required_version = ">= 1.6"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.30"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # Use a remote backend for real use (state contains the generated
  # ENCRYPTION_KEY and CRON_SECRET), e.g.:
  # backend "gcs" {
  #   bucket = "acme-tfstate"
  #   prefix = "usertasks"
  # }
}

provider "google" {
  project = var.project_id
  region  = var.region
}
