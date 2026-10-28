terraform {
  required_version = ">= 1.6"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.90"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # Use a remote backend for real use (state contains the generated
  # ENCRYPTION_KEY and CRON_SECRET), e.g.:
  # backend "s3" {
  #   bucket       = "acme-tfstate"
  #   key          = "usertasks/terraform.tfstate"
  #   region       = "eu-west-1"
  #   use_lockfile = true
  # }
}

provider "aws" {
  region = var.region

  default_tags {
    tags = { Application = "usertasks", Profile = "aws-reference" }
  }
}
