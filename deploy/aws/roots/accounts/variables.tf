variable "existing_organization_id" {
  type    = string
  default = ""
}
variable "parent_ou_id" {
  type    = string
  default = ""
}
variable "existing_members" {
  type    = map(string)
  default = {}
}
variable "new_members" {
  type    = map(object({ name = string }))
  default = {}
}
variable "contacts" {
  type      = map(string)
  sensitive = true
  default   = {}
}
