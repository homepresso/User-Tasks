terraform {
  required_version = ">= 1.6"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.20"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # Configure a remote backend for real use (state contains the generated
  # ENCRYPTION_KEY and CRON_SECRET), e.g.:
  # backend "azurerm" {
  #   resource_group_name  = "tfstate"
  #   storage_account_name = "tfstateacme"
  #   container_name       = "tfstate"
  #   key                  = "usertasks.tfstate"
  #   use_azuread_auth     = true
  # }
}

provider "azurerm" {
  features {
    key_vault {
      purge_soft_delete_on_destroy = false
    }
  }
  subscription_id = var.subscription_id
  # The storage account has shared-key access disabled; use Entra ID for
  # data-plane calls.
  storage_use_azuread = true
}
