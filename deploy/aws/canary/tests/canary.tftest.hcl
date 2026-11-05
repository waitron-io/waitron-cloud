mock_provider "aws" {
  mock_data "aws_region" {
    defaults = {
      region = "eu-south-2"
    }
  }
}

run "offline_region" {
  command = plan

  assert {
    condition     = data.aws_region.current.region == "eu-south-2"
    error_message = "Expected the mocked Madrid region"
  }
}
